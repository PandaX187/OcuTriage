import io
import os
import uuid
import base64
import sqlite3
from datetime import datetime

import cv2
import numpy as np
import tensorflow as tf
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from PIL import Image
from passlib.context import CryptContext

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
DATABASE_PATH = "ocutriage.db"
UPLOAD_DIR = "saved_scans"

os.makedirs(UPLOAD_DIR, exist_ok=True)

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# =========================
# LOAD MODEL
# =========================
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    model.build((None, 224, 224, 3))
    print("Model loaded and built successfully.")
except Exception as e:
    raise RuntimeError(f"Error loading model: {e}") from e


# =========================
# DATABASE
# =========================
def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS clinicians (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            department TEXT,
            license_number TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS scans (
            id TEXT PRIMARY KEY,
            clinician_id TEXT NOT NULL,
            patient_id TEXT NOT NULL,
            clinical_note TEXT,
            diagnosis TEXT NOT NULL,
            confidence REAL NOT NULL,
            confidence_label TEXT,
            recommendation TEXT,
            risk_level TEXT,
            quality_status TEXT,
            sharpness REAL,
            brightness REAL,
            original_image TEXT,
            heatmap_image TEXT,
            ai_explanation TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (clinician_id) REFERENCES clinicians(id)
        )
        """
    )

    conn.commit()
    conn.close()


init_db()


# =========================
# REQUEST MODELS
# =========================
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    department: str | None = None
    licenseNumber: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# =========================
# HELPERS
# =========================
def validate_password(password):
    if len(password) < 6:
        return False, "Password must be at least 6 characters."

    if len(password.encode("utf-8")) > 72:
        return False, "Password must be 72 bytes or fewer. Please use a shorter password."

    return True, None


def clinician_row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "department": row["department"],
        "license_number": row["license_number"],
        "created_at": row["created_at"],
    }


def scan_row_to_dict(row):
    return {
        "id": row["id"],
        "clinician_id": row["clinician_id"],
        "patient_id": row["patient_id"],
        "clinical_note": row["clinical_note"],
        "diagnosis": row["diagnosis"],
        "confidence": row["confidence"],
        "backend_status": row["confidence_label"],
        "recommendation": row["recommendation"],
        "risk_level": row["risk_level"],
        "quality_status": row["quality_status"],
        "quality_metrics": {
            "sharpness": row["sharpness"],
            "brightness": row["brightness"],
        },
        "original_image": row["original_image"],
        "heatmap_image": row["heatmap_image"],
        "ai_explanation": row["ai_explanation"],
        "created_at": row["created_at"],
    }


def get_risk_level(diagnosis):
    text = diagnosis.lower()
    if "green" in text:
        return "Low"
    if "yellow" in text:
        return "Moderate"
    if "red" in text:
        return "High"
    return "Unknown"


def get_recommendation(diagnosis):
    text = diagnosis.lower()
    if "green" in text:
        return "Routine screening recommended"
    if "yellow" in text:
        return "Schedule ophthalmology follow-up"
    if "red" in text:
        return "Refer to specialist urgently"
    return "Clinical review recommended"


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

    dark_ratio = np.mean(gray < 25)

    hue = hsv[:, :, 0]
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]

    warm_mask = (
        (((hue >= 5) & (hue <= 35)) | ((hue >= 160) & (hue <= 179)))
        & (sat > 40)
        & (val > 40)
    )
    warm_ratio = np.mean(warm_mask)

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
    try:
        base_model = full_model.get_layer("efficientnetb0")
        last_conv_layer = base_model.get_layer("top_activation")

        base_grad_model = tf.keras.models.Model(
            [base_model.inputs], [last_conv_layer.output, base_model.output]
        )

        with tf.GradientTape() as tape:
            conv_outputs, base_outputs = base_grad_model(img_tensor)
            tape.watch(conv_outputs)

            x = base_outputs
            for layer in full_model.layers[1:]:
                x = layer(x, training=False)

            predictions = x
            top_pred_index = tf.argmax(predictions[0])
            top_class_channel = predictions[:, top_pred_index]

        grads = tape.gradient(top_class_channel, conv_outputs)
        weights = tf.reduce_mean(grads, axis=(0, 1, 2))

        output = conv_outputs[0]
        heatmap = tf.reduce_sum(tf.multiply(weights, output), axis=-1)

        heatmap = np.maximum(heatmap, 0)
        if np.max(heatmap) != 0:
            heatmap /= np.max(heatmap)

        return heatmap

    except Exception as e:
        print(f"Grad-CAM failed: {e}")
        return np.zeros((7, 7))


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


def encode_pil_to_base64_png(img_pil):
    buffer = io.BytesIO()
    display_img = img_pil.copy()
    display_img.thumbnail((900, 900))
    display_img.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def confidence_label_from_prob(confidence):
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
    return {"status": "ok", "model_loaded": True, "database": DATABASE_PATH}


# =========================
# AUTH ROUTES
# =========================
@app.post("/register")
async def register(payload: RegisterRequest):
    try:
        name = payload.name.strip()
        email = payload.email.lower().strip()
        password = payload.password

        password_valid, password_error = validate_password(password)
        if not password_valid:
            return JSONResponse(
                status_code=400,
                content={"message": password_error},
            )

        clinician_id = str(uuid.uuid4())
        password_hash = password_context.hash(password)
        created_at = datetime.utcnow().isoformat()

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO clinicians (
                id, name, email, password_hash, department, license_number, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                clinician_id,
                name,
                email,
                password_hash,
                payload.department,
                payload.licenseNumber,
                created_at,
            ),
        )

        conn.commit()
        row = cursor.execute(
            "SELECT * FROM clinicians WHERE id = ?", (clinician_id,)
        ).fetchone()
        conn.close()

        return {"clinician": clinician_row_to_dict(row)}

    except sqlite3.IntegrityError:
        return JSONResponse(
            status_code=409,
            content={"message": "An account with this email already exists."},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"},
        )


@app.post("/login")
async def login(payload: LoginRequest):
    try:
        email = payload.email.lower().strip()

        conn = get_db_connection()
        row = conn.execute("SELECT * FROM clinicians WHERE email = ?", (email,)).fetchone()
        conn.close()

        if row is None:
            return JSONResponse(
                status_code=401,
                content={"message": "Invalid email or password."},
            )

        password_length_valid, password_error = validate_password(payload.password)
        if not password_length_valid:
            return JSONResponse(
                status_code=400,
                content={"message": password_error},
            )

        password_valid = password_context.verify(payload.password, row["password_hash"])
        if not password_valid:
            return JSONResponse(
                status_code=401,
                content={"message": "Invalid email or password."},
            )

        return {"clinician": clinician_row_to_dict(row)}

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"},
        )


# =========================
# SCAN ROUTES
# =========================
@app.get("/clinicians/{clinician_id}/scans")
async def get_clinician_scans(clinician_id: str):
    try:
        conn = get_db_connection()
        rows = conn.execute(
            """
            SELECT * FROM scans
            WHERE clinician_id = ?
            ORDER BY created_at DESC
            """,
            (clinician_id,),
        ).fetchall()
        conn.close()

        return {"scans": [scan_row_to_dict(row) for row in rows]}

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"},
        )


@app.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        row = cursor.execute("SELECT * FROM scans WHERE id = ?", (scan_id,)).fetchone()
        if row is None:
            conn.close()
            return JSONResponse(
                status_code=404,
                content={"message": "Scan not found."},
            )

        cursor.execute("DELETE FROM scans WHERE id = ?", (scan_id,))
        conn.commit()
        conn.close()

        return {"message": "Scan deleted successfully."}

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"},
        )


# =========================
# PREDICT + SAVE SCAN
# =========================
@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    clinician_id: str = Form(...),
    patient_id: str = Form(...),
    clinical_note: str = Form(""),
):
    try:
        patient_id = patient_id.strip()
        clinician_id = clinician_id.strip()

        if not patient_id:
            return JSONResponse(
                status_code=400,
                content={"message": "Patient ID is required."},
            )

        conn = get_db_connection()
        clinician = conn.execute(
            "SELECT * FROM clinicians WHERE id = ?", (clinician_id,)
        ).fetchone()
        conn.close()

        if clinician is None:
            return JSONResponse(
                status_code=404,
                content={"message": "Clinician account not found."},
            )

        request_object_content = await file.read()
        img_raw = Image.open(io.BytesIO(request_object_content)).convert("RGB")

        is_retina, retina_error = is_likely_retina_scan(img_raw)
        if not is_retina:
            return JSONResponse(status_code=400, content={"message": retina_error})

        sharpness_score, brightness_score = calculate_quality_metrics(img_raw)
        print(f"Sharpness: {sharpness_score:.2f} | Brightness: {brightness_score:.2f}")

        if sharpness_score < 10:
            return JSONResponse(
                status_code=400,
                content={"message": "Quality Error: Image too blurry. Please retake."},
            )

        if brightness_score < 15 or brightness_score > 240:
            return JSONResponse(
                status_code=400,
                content={"message": "Quality Error: Poor lighting detected. Please retake."},
            )

        img_resized_pil, img_tensor = preprocess_for_model(img_raw)

        preds = model.predict(img_tensor, verbose=0)
        class_idx = int(np.argmax(preds[0]))
        diagnosis = CLASS_NAMES[class_idx]
        confidence_percent = round(float(np.max(preds[0])) * 100, 2)
        confidence_label = confidence_label_from_prob(confidence_percent)
        risk_level = get_risk_level(diagnosis)
        recommendation = get_recommendation(diagnosis)

        heatmap = generate_clinical_gradcam(img_tensor, model)
        overlay_bgr = create_gradcam_overlay(img_raw, heatmap, alpha=0.4)
        heatmap_base64 = encode_bgr_to_base64_png(overlay_bgr)
        heatmap_data_url = f"data:image/png;base64,{heatmap_base64}"
        original_image_data_url = encode_pil_to_base64_png(img_raw)

        ai_explanation = (
            "The Grad-CAM heatmap highlights the retinal regions that most influenced "
            "the model's prediction. Warmer colors indicate areas of greater importance "
            "in the AI decision process."
        )

        scan_id = str(uuid.uuid4())
        created_at = datetime.utcnow().isoformat()

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO scans (
                id,
                clinician_id,
                patient_id,
                clinical_note,
                diagnosis,
                confidence,
                confidence_label,
                recommendation,
                risk_level,
                quality_status,
                sharpness,
                brightness,
                original_image,
                heatmap_image,
                ai_explanation,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scan_id,
                clinician_id,
                patient_id,
                clinical_note,
                diagnosis,
                confidence_percent,
                confidence_label,
                recommendation,
                risk_level,
                "Accepted",
                round(sharpness_score, 2),
                round(brightness_score, 2),
                original_image_data_url,
                heatmap_data_url,
                ai_explanation,
                created_at,
            ),
        )
        conn.commit()
        conn.close()

        return {
            "scan_id": scan_id,
            "diagnosis": diagnosis,
            "confidence": confidence_percent,
            "confidence_label": confidence_label,
            "recommendation": recommendation,
            "risk_level": risk_level,
            "heatmap_image": heatmap_data_url,
            "original_image": original_image_data_url,
            "quality_status": "Accepted",
            "quality_metrics": {
                "sharpness": round(sharpness_score, 2),
                "brightness": round(brightness_score, 2),
            },
            "created_at": created_at,
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"message": f"Server Error: {str(e)}"},
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
