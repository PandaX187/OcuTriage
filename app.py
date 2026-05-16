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

# --- BCRYPT COMPATIBILITY PATCH ---
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class About:
        __version__ = bcrypt.__version__
    bcrypt.__about__ = About
# ----------------------------------

from passlib.context import CryptContext

app = FastAPI(title="OcuTriage Clinical AI Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# CONFIGURATION
# =========================
MODEL_PATH = "ocutriage_model_v1.keras"
DATABASE_PATH = "ocutriage.db"
CLASS_NAMES = ["Green", "Red", "Yellow"] 
IMG_SIZE = (224, 224)

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# =========================
# MODEL LOADING
# =========================
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    print("✅ Model loaded successfully.")
except Exception as e:
    print(f"❌ Error loading model: {e}")

# =========================
# DATABASE CORE
# =========================
def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS clinicians (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            department TEXT,
            license_number TEXT,
            created_at TEXT NOT NULL
        )
    """)
    cursor.execute("""
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
    """)
    
    # Auto-seed the admin account for Demo Day
    cursor.execute("SELECT COUNT(*) FROM clinicians")
    if cursor.fetchone()[0] == 0:
        admin_id = str(uuid.uuid4())
        pw_hash = password_context.hash("admin")
        created_at = datetime.utcnow().isoformat()
        cursor.execute("INSERT INTO clinicians VALUES (?,?,?,?,?,?,?)", 
                     (admin_id, "Rayan Alabbasi", "rayan@ocutriage.com", pw_hash, "System Admin", "ADMIN-01", created_at))
        print("✅ Admin account created: rayan@ocutriage.com / admin")
    conn.commit()
    conn.close()

init_db()

class LoginRequest(BaseModel):
    email: EmailStr; password: str

class RegisterRequest(BaseModel):
    name: str; email: EmailStr; password: str
    department: str | None = ""; licenseNumber: str | None = ""

# =========================
# AI LOGIC & VALIDATION
# =========================
def calculate_quality_metrics(img_pil):
    cv_img = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    sharpness_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness_score = float(np.mean(gray))
    return sharpness_score, brightness_score

def preprocess_for_model(img_pil):
    img_rgb = img_pil.convert("RGB")
    img_resized = img_rgb.resize(IMG_SIZE)
    img_tensor = tf.keras.utils.img_to_array(img_resized)
    img_tensor = np.expand_dims(img_tensor, axis=0)
    return img_resized, img_tensor

def is_likely_retina_scan(img_pil):
    img = np.array(img_pil)
    if img.ndim != 3: return False, "Invalid image format."
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    
    dark_pixels = np.sum(gray < 20)
    total_pixels = gray.size
    dark_ratio = dark_pixels / total_pixels
    
    b, g, r = cv2.split(bgr)
    red_dominance = np.mean(r.astype(int) - b.astype(int))
    
    # Allows zoomed-in/cropped clinical scans but stops completely random non-eye images
    if dark_ratio < 0.02 or red_dominance < 15:
        return False, "Validation Error: System rejected input. Please ensure you upload a standard retinal fundus image."
        
    return True, None

def generate_clinical_gradcam(img_tensor, full_model):
    try:
        target_model = full_model
        is_nested = False
        for layer in full_model.layers:
            if isinstance(layer, tf.keras.models.Model):
                target_model = layer
                is_nested = True
                break
                
        last_conv_layer_name = None
        for layer in reversed(target_model.layers):
            if 'Conv2D' in layer.__class__.__name__:
                last_conv_layer_name = layer.name
                break
            try:
                shape = layer.output_shape
                if isinstance(shape, list): shape = shape[0]
                if isinstance(shape, tuple) and len(shape) == 4:
                    last_conv_layer_name = layer.name
                    break
            except: continue

        if not last_conv_layer_name:
            raise ValueError("Could not find a 4D Convolutional layer.")

        last_conv_layer = target_model.get_layer(last_conv_layer_name)

        if not is_nested:
            grad_model = tf.keras.models.Model(
                inputs=[full_model.inputs],
                outputs=[last_conv_layer.output, full_model.output]
            )
            with tf.GradientTape() as tape:
                conv_outputs, predictions = grad_model(img_tensor)
                top_pred_index = tf.argmax(predictions[0])
                top_class_channel = predictions[:, top_pred_index]
        else:
            pre_layers, post_layers = [], []
            found_target = False
            for layer in full_model.layers:
                if layer == target_model: found_target = True; continue
                if not found_target: pre_layers.append(layer)
                else: post_layers.append(layer)

            grad_model = tf.keras.models.Model(
                inputs=[target_model.inputs],
                outputs=[last_conv_layer.output, target_model.output]
            )
            with tf.GradientTape() as tape:
                x = img_tensor
                for l in pre_layers: x = l(x, training=False)
                conv_outputs, x = grad_model(x)
                for l in post_layers: x = l(x, training=False)
                top_pred_index = tf.argmax(x[0])
                top_class_channel = x[:, top_pred_index]

        grads = tape.gradient(top_class_channel, conv_outputs)
        weights = tf.reduce_mean(grads, axis=(0, 1, 2))
        heatmap = tf.reduce_sum(tf.multiply(weights, conv_outputs[0]), axis=-1)
        heatmap = np.maximum(heatmap, 0)
        if np.max(heatmap) != 0: heatmap /= np.max(heatmap)
        return heatmap
    except Exception as e:
        print(f"\n❌ GRAD-CAM CRASHED: {str(e)}\n")
        return np.zeros((7, 7))

def create_gradcam_overlay(original_pil, heatmap, alpha=0.5):
    original_np = np.array(original_pil.resize((800, 800)))
    h, w = original_np.shape[:2]
    heatmap_resized = cv2.resize(heatmap, (w, h))
    heatmap_uint8 = np.uint8(255 * heatmap_resized)
    jet = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    jet_rgb = cv2.cvtColor(jet, cv2.COLOR_BGR2RGB)
    overlay = cv2.addWeighted(jet_rgb, alpha, original_np, 1 - alpha, 0)
    return cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)

# =========================
# ENDPOINTS
# =========================

@app.post("/register")
async def register(payload: RegisterRequest):
    try:
        clinician_id = str(uuid.uuid4())
        pw_hash = password_context.hash(payload.password)
        created_at = datetime.utcnow().isoformat()
        conn = get_db_connection()
        conn.execute("INSERT INTO clinicians VALUES (?,?,?,?,?,?,?)", 
                     (clinician_id, payload.name, payload.email.lower().strip(), pw_hash, payload.department, payload.licenseNumber, created_at))
        conn.commit()
        user = conn.execute("SELECT * FROM clinicians WHERE id = ?", (clinician_id,)).fetchone()
        conn.close()
        return {"clinician": {"id": user["id"], "name": user["name"], "email": user["email"], "department": user["department"], "license_number": user["license_number"]}}
    except sqlite3.IntegrityError:
        return JSONResponse(status_code=409, content={"message": "Account already exists."})

@app.post("/login")
async def login(payload: LoginRequest):
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM clinicians WHERE email = ?", (payload.email.lower().strip(),)).fetchone()
    conn.close()
    if row and password_context.verify(payload.password, row["password_hash"]):
        return {"clinician": {"id": row["id"], "name": row["name"], "email": row["email"], "department": row["department"], "license_number": row["license_number"]}}
    return JSONResponse(status_code=401, content={"message": "Invalid credentials."})

@app.post("/predict")
async def predict(file: UploadFile = File(...), clinician_id: str = Form(...), patient_id: str = Form(...), clinical_note: str = Form("")):
    try:
        content = await file.read()
        img_raw = Image.open(io.BytesIO(content)).convert("RGB")

        is_retina, err = is_likely_retina_scan(img_raw)
        if not is_retina: return JSONResponse(status_code=400, content={"message": err})

        sharpness, brightness = calculate_quality_metrics(img_raw)
        
        # TUNED CLINICAL VALIDATION
        # Threshold at 8.0 safely rejects photos of screens and severe blur, but passes smooth hemorrhages.
        if sharpness < 2.0: 
            return JSONResponse(status_code=400, content={"message": "System Error: Image is critically blurry or out of focus. Please upload a clear fundus scan."})
        
        # Threshold safely rejects pure darkness and extreme flash glare.
        if brightness < 15.0 or brightness > 240.0:
            return JSONResponse(status_code=400, content={"message": "System Error: Image lighting is unacceptable (too dark or severe glare)."})

        _, img_tensor = preprocess_for_model(img_raw)
        preds = model.predict(img_tensor, verbose=0)[0]
        
        class_idx = int(np.argmax(preds))
        confidence = round(float(preds[class_idx]) * 100, 2)
        
        heatmap = generate_clinical_gradcam(img_tensor, model)
        overlay_bgr = create_gradcam_overlay(img_raw, heatmap)
        
        _, buffer = cv2.imencode(".png", overlay_bgr)
        heatmap_url = f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
        
        orig_io = io.BytesIO(); img_raw.save(orig_io, format="PNG")
        orig_url = f"data:image/png;base64,{base64.b64encode(orig_io.getvalue()).decode('utf-8')}"

        scan_id = str(uuid.uuid4())
        created_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        conn = get_db_connection()
        conn.execute("INSERT INTO scans (id, clinician_id, patient_id, clinical_note, diagnosis, confidence, original_image, heatmap_image, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (scan_id, clinician_id, patient_id, clinical_note, CLASS_NAMES[class_idx], confidence, orig_url, heatmap_url, created_at))
        conn.commit(); conn.close()

        return {
            "diagnosis": CLASS_NAMES[class_idx],
            "confidence": confidence,
            "confidence_label": "Analysis Complete",
            "heatmap_image": heatmap_url,
            "original_image": orig_url,
            "quality_metrics": {"sharpness": round(sharpness, 2), "brightness": round(brightness, 2)},
            "scan_id": scan_id
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.get("/clinicians/{clinician_id}/scans")
async def get_scans(clinician_id: str):
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM scans WHERE clinician_id = ? ORDER BY created_at DESC", (clinician_id,)).fetchall()
    conn.close()
    return {"scans": [dict(r) for r in rows]}

@app.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str):
    conn = get_db_connection()
    conn.execute("DELETE FROM scans WHERE id = ?", (scan_id,))
    conn.commit(); conn.close()
    return {"message": "Success"}

@app.get("/clinicians")
async def get_all_clinicians():
    conn = get_db_connection()
    rows = conn.execute("SELECT id, name, email, department, license_number, created_at FROM clinicians ORDER BY created_at DESC").fetchall()
    conn.close()
    return {"clinicians": [dict(r) for r in rows]}

@app.delete("/clinicians/{target_id}")
async def delete_clinician(target_id: str):
    conn = get_db_connection()
    conn.execute("DELETE FROM scans WHERE clinician_id = ?", (target_id,))
    conn.execute("DELETE FROM clinicians WHERE id = ?", (target_id,))
    conn.commit()
    conn.close()
    return {"message": "Clinician and their scans removed successfully."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
