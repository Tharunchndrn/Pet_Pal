import os
import sys
from fastapi import FastAPI
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
EMOTION_CLASSIFIER_DIR = os.path.join(PROJECT_ROOT, "backend", "emotion_classifier")

sys.path.insert(0, EMOTION_CLASSIFIER_DIR)

app = FastAPI()

class EmotionRequest(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"ok": True, "service": "emotion-api"}

@app.post("/predict-emotion")
def predict_emotion(req: EmotionRequest):
    try:
        from classifier import get_emotion

        text = (req.text or "").strip()

        if not text:
            return {"ok": False, "emotion": "unknown", "error": "Empty text"}

        emotion = get_emotion(text)
        return {"ok": True, "emotion": emotion}

    except Exception as e:
        return {"ok": False, "emotion": "unknown", "error": str(e)}
