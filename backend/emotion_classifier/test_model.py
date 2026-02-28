from emotion_classifier.classifier import get_emotion
import os

# Set the model directory explicitly if needed
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "emotion_classifier", "emotion_model")

print(f"Testing model at: {MODEL_DIR}")

test_sentences = [
    "I am so happy and excited!",
    "I feel really sad and lonely today.",
    "I am very angry about what happened.",
    "Feeling a bit anxious about the meeting.",
    "I am confused about the instructions."
]

for sentence in test_sentences:
    emotion = get_emotion(sentence, model_dir=MODEL_DIR)
    print(f"\nText: {sentence}")
    print(f"Detected Emotion: {emotion}")
