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
    """
    Match training notebook behavior:
    - resize to 224x224
    - convert to array
    - DO NOT divide by 255
    """
    img_resized = img_pil.resize(IMG_SIZE)
    img_tensor = tf.keras.utils.img_to_array(img_resized)
    img_tensor = np.expand_dims(img_tensor, axis=0).astype(np.float32)
    return img_resized, img_tensor


def generate_clinical_gradcam(img_tensor, model):
    """
    Grad-CAM implementation based directly on the training notebook logic.
    This avoids rebuilding a separate graph model and instead uses:
    - feature extractor = efficientnetb0
    - classifier head = remaining sequential layers
    - logits = manual dense computation (pre-softmax)
    """
    feature_extractor = model.get_layer("efficientnetb0")
    classifier_layers = model.layers[1:]

    with tf.GradientTape() as tape:
        feature_maps = feature_extractor(img_tensor, training=False)
        tape.watch(feature_maps)

        x = feature_maps

        # Run through GAP -> BatchNorm -> Dropout
        for layer in classifier_layers[:-1]:
            x = layer(x, training=False)

        # Final Dense layer, but use raw logits before softmax
        final_dense = classifier_layers[-1]
        logits = tf.matmul(x, final_dense.kernel) + final_dense.bias

        top_pred_index = tf.argmax(logits[0])
        top_class_channel = logits[:, top_pred_index]

    grads = tape.gradient(top_class_channel, feature_maps)
    if grads is None:
        raise ValueError("Could not compute gradients for Grad-CAM.")

    weights = tf.reduce_mean(grads, axis=(0, 1, 2))
    output = feature_maps[0]
    heatmap = tf.reduce_sum(tf.multiply(weights, output), axis=-1)

    heatmap = np.maximum(heatmap.numpy(), 0)
    if np.max(heatmap) != 0:
        heatmap /= np.max(heatmap)

    return heatmap


def create_gradcam_overlay(original_pil, heatmap, alpha=0.4):
    """
    Create a nicer returned visualization:
    - preserve aspect ratio for display
    - resize heatmap to display size
    - overlay colored map on original
    - encode as PNG for better quality
    """
    display_img = original_pil.copy()
    display_img.thumbnail((900, 900))  # keeps aspect ratio

    display_rgb = np.array(display_img)
    h, w = display_rgb.shape[:2]

    heatmap_resized = cv2.resize(heatmap, (w, h))
    heatmap_uint8 = np.uint8(255 * heatmap_resized)

    # JET color map like notebook
    jet = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    jet_rgb = cv2.cvtColor(jet, cv2.COLOR_BGR2RGB)

    # Normalize original for blending
    original_float = display_rgb.astype("float32") / 255.0
    jet_float = jet_rgb.astype("float32") / 255.0

    superimposed = jet_float * alpha + original_float
    superimposed = np.clip(superimposed, 0, 1)

    # Back to BGR for OpenCV encoding
    superimposed_uint8 = np.uint8(superimposed * 255)
    superimposed_bgr = cv2.cvtColor(superimposed_uint8, cv2.COLOR_RGB2BGR)
    return superimposed_bgr


def encode_bgr_to_base64_png(img_bgr):
    ok, buffer = cv2.imencode(".png", img_bgr)
    if not ok:
        raise ValueError("Failed to encode image.")
    return base64.b64encode(buffer).decode("utf-8")


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

        # --- IMAGE QUALITY ASSESSMENT (IQA) ---
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
        # --------------------------------------

        # Prepare image
        img_resized_pil, img_tensor = preprocess_for_model(img_raw)

        # Predict diagnosis
        preds = model.predict(img_tensor, verbose=0)
        class_idx = int(np.argmax(preds[0]))
        diagnosis = CLASS_NAMES[class_idx]
        confidence_percent = round(float(np.max(preds[0])) * 100, 2)

        # Real Grad-CAM
        heatmap = generate_clinical_gradcam(img_tensor, model)

        # Build returned visualization overlay
        overlay_bgr = create_gradcam_overlay(img_raw, heatmap, alpha=0.4)
        img_base64 = encode_bgr_to_base64_png(overlay_bgr)

        return {
            "diagnosis": diagnosis,
            "confidence": confidence_percent,
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
