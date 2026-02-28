import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import os

class EmotionClassifier:
    def __init__(self, model_path):
        """Load the trained emotion classification model and tokenizer."""
        print(f"Loading emotion classifier from {model_path}...")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.model.to(self.device)
        self.model.eval()

    def predict(self, text):
        """Predict the emotion for a given text string."""
        inputs = self.tokenizer(
            text, 
            return_tensors="pt", 
            truncation=True, 
            max_length=128, 
            padding=True
        ).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            
        prediction = torch.argmax(logits, dim=-1).item()
        # Map ID back to label name
        return self.model.config.id2label[prediction]

# Singleton instance to be used by the backend
_classifier = None

def get_emotion(text, model_dir=None):
    global _classifier
    if _classifier is None:
        if model_dir is None:
            # Default path relative to this file
            model_dir = os.path.join(os.path.dirname(__file__), "emotion_model")
        
        if not os.path.exists(model_dir):
            return "unknown" # Or return neutral if model not found yet
            
        _classifier = EmotionClassifier(model_dir)
        
    return _classifier.predict(text)
