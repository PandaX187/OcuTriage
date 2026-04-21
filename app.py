import io
import base64
import numpy as np
import tensorflow as tf
import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

# =========================
# INIT API
# =========================
app = FastAPI(title="OcuTriage Clinical AI Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = "ocutriage_model_v1.h5"
CLASS_NAMES = ["Green - No DR", "Yellow - Moderate", "Red - Severe"]
IMG_SIZE = (224, 224)

# =========================
# LOAD MODEL
# =========================
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    model.build((None, 224, 224, 3))
    print("✅ Model loaded and built successfully.")
except Exception as e:
    raise RuntimeError(f"❌ Error loading model: {e}") from e


# =========================
# HELPERS
# =========================
def calculate_quality_metrics(img_pil):
    cv_img = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    sharpness_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness_score = float(np.mean(gray))
    return sharpness_score, brightness_score


def preprocess_for_model(img_pil):
    img_resized = img_pil.resize(IMG_SIZE)
    img_tensor = tf.keras.utils.img_to_array(img_resized)
    img_tensor = np.expand_dims(img_tensor, axis=0)

    # --- THE FIX: EfficientNet Preprocessing ---
    # This scales the pixels exactly how the AI expects,
    # preventing the model from confusing Yellows and Reds.
    img_tensor = tf.keras.applications.efficientnet.preprocess_input(img_tensor)

    return img_resized, img_tensor


def is_likely_retina_scan(img_pil):
    """
    Heuristic validation for retinal fundus images.
    This blocks obviously unrelated images like documents/screenshots/resumes.
    """
    img = np.array(img_pil)
    if img.ndim != 3 or img.shape[2] != 3:
        return False, "Input Error: Please upload a retinal fundus image only."

    h, w, _ = img.shape
    if h < 150 or w < 150:
        return False, "Input Error: Image is too small. Please upload a retinal fundus image."

    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # --- 1. Detect large dark border around fundus-like circle ---
    dark_ratio = np.mean(gray < 25)

    # --- 2. Detect warm retinal colors (orange/red/yellow-ish) ---
    hue = hsv[:, :, 0]
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]

    warm_mask = (
            (((hue >= 5) & (hue <= 35)) | ((hue >= 160) & (hue <= 179))) &
            (sat > 40) &
            (val > 40)
    )
    warm_ratio = np.mean(warm_mask)

    # --- 3. Circular central structure check using Hough circles ---
    blurred = cv2.medianBlur(gray, 7)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min(h, w) // 2,
        param1=80,
        param2=30,
        minRadius=min(h, w) // 5,
        maxRadius=min(h, w) // 2,
    )

    has_circle = circles is not None

    score = 0
    if dark_ratio > 0.15:
        score += 1
    if warm_ratio > 0.20:
        score += 1
    if has_circle:
        score += 1

    if score < 2:
        return False, "Input Error: Please upload a valid retinal fundus image only."

    return True, None


def generate_clinical_gradcam(img_tensor, full_model):
    """
    Corrected Clinical Grad-CAM.
    Reaches INSIDE the EfficientNet base to preserve the 7x7 spatial feature map.
    """
    try:
        # 1. Get the nested base model and the target visual layer
        base_model = full_model.get_layer("efficientnetb0")
        last_conv_layer = base_model.get_layer("top_activation")

        # 2. Build a sub-model that outputs both the visual map AND the base model's final output
        base_grad_model = tf.keras.models.Model(
            [base_model.inputs], [last_conv_layer.output, base_model.output]
        )

        with tf.GradientTape() as tape:
            # 3. Get the 7x7 visual map and the base output
            conv_outputs, base_outputs = base_grad_model(img_tensor)
            tape.watch(conv_outputs)

            # 4. Manually pass the data through custom classification layers (Dropout, Dense, etc.)
            x = base_outputs
            for layer in full_model.layers[1:]:
                x = layer(x, training=False)

            predictions = x
            top_pred_index = tf.argmax(predictions[0])
            top_class_channel = predictions[:, top_pred_index]

        # 5. Calculate the gradients based on the 7x7 map, NOT the flattened output
        grads = tape.gradient(top_class_channel, conv_outputs)
        weights = tf.reduce_mean(grads, axis=(0, 1, 2))

        output = conv_outputs[0]
        heatmap = tf.reduce_sum(tf.multiply(weights, output), axis=-1)

        # Normalize
        heatmap = np.maximum(heatmap, 0)
        if np.max(heatmap) != 0:
            heatmap /= np.max(heatmap)

        return heatmap

    except Exception as e:
        print(f"⚠️ Grad-CAM failed: {e}")
        return np.zeros((7, 7))  # Return safe blank heatmap if math fails


def create_gradcam_overlay(original_pil, heatmap, alpha=0.4):
    display_img = original_pil.copy()
    display_img.thumbnail((900, 900))

    display_rgb = np.array(display_img)
    h, w = display_rgb.shape[:2]

    heatmap_resized = cv2.resize(heatmap, (w, h))
    heatmap_uint8 = np.uint8(255 * heatmap_resized)

    jet = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    jet_rgb = cv2.cvtColor(jet, cv2.COLOR_BGR2RGB)

    original_float = display_rgb.astype("float32") / 255.0
    jet_float = jet_rgb.astype("float32") / 255.0

    superimposed = jet_float * alpha + original_float
    superimposed = np.clip(superimposed, 0, 1)

    superimposed_uint8 = np.uint8(superimposed * 255)
    superimposed_bgr = cv2.cvtColor(superimposed_uint8, cv2.COLOR_RGB2BGR)
    return superimposed_bgr


def encode_bgr_to_base64_png(img_bgr):
    ok, buffer = cv2.imencode(".png", img_bgr)
    if not ok:
        raise ValueError("Failed to encode image.")
    return base64.b64encode(buffer).decode("utf-8")


def confidence_label_from_prob(confidence):
    """
    Cleaner confidence interpretation.
    This is still NOT true calibration, but better UI wording.
    """
    if confidence >= 90:
        return "High confidence"
    if confidence >= 75:
        return "Moderate confidence"
    return "Low confidence"


# =========================
# HEALTH CHECK
# =========================
@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": True}


# =========================
# PREDICT
# =========================
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    try:
        request_object_content = await file.read()
        img_raw = Image.open(io.BytesIO(request_object_content)).convert("RGB")

        # --- RETINA VALIDATION ---
        is_retina, retina_error = is_likely_retina_scan(img_raw)
        if not is_retina:
            return JSONResponse(
                status_code=400,
                content={"message": retina_error}
            )

        # --- IMAGE QUALITY ASSESSMENT ---
        sharpness_score, brightness_score = calculate_quality_metrics(img_raw)
        print(f"🔍 DEBUG - Sharpness: {sharpness_score:.2f} | Brightness: {brightness_score:.2f}")

        if sharpness_score < 10:
            return JSONResponse(
                status_code=400,
                content={"message": "Quality Error: Image too blurry. Please retake."}
            )

        if brightness_score < 15 or brightness_score > 240:
            return JSONResponse(
                status_code=400,
                content={"message": "Quality Error: Poor lighting detected. Please retake."}
            )

        # Prepare image
        img_resized_pil, img_tensor = preprocess_for_model(img_raw)

        # Predict
        preds = model.predict(img_tensor, verbose=0)
        class_idx = int(np.argmax(preds[0]))
        diagnosis = CLASS_NAMES[class_idx]
        confidence_percent = round(float(np.max(preds[0])) * 100, 2)
        confidence_label = confidence_label_from_prob(confidence_percent)

        # Grad-CAM
        heatmap = generate_clinical_gradcam(img_tensor, model)

        # Overlay
        overlay_bgr = create_gradcam_overlay(img_raw, heatmap, alpha=0.4)
        img_base64 = encode_bgr_to_base64_png(overlay_bgr)

        return {
            "diagnosis": diagnosis,
            "confidence": confidence_percent,
            "confidence_label": confidence_label,
            "heatmap_image": f"data:image/png;base64,{img_base64}",
            "quality_metrics": {
                "sharpness": round(sharpness_score, 2),
                "brightness": round(brightness_score, 2)
            }
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"}
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
