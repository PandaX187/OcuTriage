import os
import io
import numpy as np
import tensorflow as tf
import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import base64

# 1. Initialize the API
app = FastAPI(title="OcuTriage Clinical AI Engine")

# FIX: Allow React frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Load the Brain safely
MODEL_PATH = "ocutriage_model_v1.h5"

try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    model.build((None, 224, 224, 3))
    print("✅ Model loaded and built successfully.")
except Exception as e:
    print(f"❌ Error loading model: {e}")

CLASS_NAMES = ["Green - No DR", "Yellow - Moderate", "Red - Severe"]


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    try:
        request_object_content = await file.read()
        img_raw = Image.open(io.BytesIO(request_object_content)).convert("RGB")

        # --- IMAGE QUALITY ASSESSMENT (IQA) ---
        cv_img = cv2.cvtColor(np.array(img_raw), cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

        sharpness_score = cv2.Laplacian(gray, cv2.CV_64F).var()
        brightness_score = np.mean(gray)

        # Print the actual scores to your VS Code terminal
        print(f"🔍 DEBUG - Sharpness: {sharpness_score:.2f} | Brightness: {brightness_score:.2f}")

        # Lowered threshold to 10 for soft retinal scans
        if sharpness_score < 10:
            return JSONResponse(status_code=400, content={"message": "Quality Error: Image too blurry. Please retake."})

        if brightness_score < 15 or brightness_score > 240:
            return JSONResponse(status_code=400,
                                content={"message": "Quality Error: Poor lighting detected. Please retake."})
        # --------------------------------------

        # Prepare image for AI
        img_raw_resized = img_raw.resize((224, 224))
        img_tensor = tf.keras.utils.img_to_array(img_raw_resized)
        img_tensor = np.expand_dims(img_tensor, axis=0)

        # 3. Predict Diagnosis (Grad-CAM temporarily bypassed for graph stability)
        preds = model.predict(img_tensor)
        class_idx = np.argmax(preds[0])
        diagnosis = CLASS_NAMES[class_idx]

        # 4. Encode Original Image for Web Display
        original_cv = cv2.cvtColor(np.array(img_raw_resized), cv2.COLOR_RGB2BGR)
        _, buffer = cv2.imencode('.jpg', original_cv)
        img_base64 = base64.b64encode(buffer).decode('utf-8')

        return {
            "diagnosis": diagnosis,
            "confidence": "Analysis Successful",
            "heatmap_image": f"data:image/jpeg;base64,{img_base64}",
            "quality_metrics": {
                "sharpness": round(sharpness_score, 2),
                "brightness": round(brightness_score, 2)
            }
        }

    except Exception as e:
        return JSONResponse(status_code=500, content={"message": f"Server Error: {str(e)}"})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
