"""
Comprehensive test for the emotion classifier.
Tests all 7 emotions: happy, calm, sad, angry, anxious, stressed, confused
with multiple example sentences per category.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from emotion_classifier.classifier import get_emotion

# Test sentences grouped by expected emotion
test_cases = {
    "happy": [
        "I am so happy and excited today!",
        "This is the best day of my life!",
        "I just got promoted, I'm thrilled!",
        "I love spending time with my friends, it makes me so joyful.",
        "Wow, what a wonderful surprise! I'm overjoyed!",
    ],
    "calm": [
        "I feel very peaceful and relaxed right now.",
        "Everything is fine, I'm just having a quiet evening.",
        "I'm feeling content and at ease with life.",
        "The weather is nice and I'm enjoying a calm moment.",
        "I'm okay, just sitting here reading a book.",
    ],
    "sad": [
        "I feel really sad and lonely today.",
        "I miss my friend so much, it hurts.",
        "I can't stop crying, everything feels hopeless.",
        "I lost my pet and I'm devastated.",
        "Nobody seems to care about how I feel.",
    ],
    "angry": [
        "I am very angry about what happened!",
        "This is so unfair, I'm furious!",
        "I can't believe they did that, I'm livid!",
        "Stop bothering me, I'm really irritated!",
        "I hate when people lie to me, it makes me so mad!",
    ],
    "anxious": [
        "I'm feeling really anxious about the upcoming exam.",
        "I can't stop worrying about what might go wrong.",
        "My heart is racing and I feel nervous about tomorrow.",
        "I have a bad feeling something terrible is going to happen.",
        "I'm so scared about the job interview, what if I fail?",
    ],
    "stressed": [
        "I have so much work to do, I'm completely overwhelmed.",
        "The deadline is tomorrow and I haven't finished anything.",
        "I can't handle all this pressure anymore.",
        "There's too much going on, I feel like I'm going to break.",
        "I haven't slept in days because of all the work pressure.",
    ],
    "confused": [
        "I don't understand what's going on.",
        "This doesn't make any sense to me at all.",
        "I'm not sure what I should do next, everything is unclear.",
        "Can someone explain this? I'm totally lost.",
        "I'm puzzled by the instructions, they're contradictory.",
    ],
}

print("=" * 70)
print("EMOTION CLASSIFIER - COMPREHENSIVE TEST")
print("=" * 70)

total = 0
correct = 0
results_by_emotion = {}

for expected_emotion, sentences in test_cases.items():
    print(f"\n{'─' * 70}")
    print(f"  EXPECTED EMOTION: {expected_emotion.upper()}")
    print(f"{'─' * 70}")
    
    emotion_correct = 0
    emotion_total = len(sentences)
    
    for sentence in sentences:
        predicted = get_emotion(sentence)
        match = predicted == expected_emotion
        status = "✓" if match else "✗"
        
        total += 1
        if match:
            correct += 1
            emotion_correct += 1
        
        print(f"  {status} \"{sentence}\"")
        print(f"    Predicted: {predicted}" + (f"  (expected: {expected_emotion})" if not match else ""))
    
    accuracy = (emotion_correct / emotion_total) * 100
    results_by_emotion[expected_emotion] = {
        "correct": emotion_correct,
        "total": emotion_total,
        "accuracy": accuracy,
    }
    print(f"\n  Accuracy for '{expected_emotion}': {emotion_correct}/{emotion_total} ({accuracy:.0f}%)")

print(f"\n{'=' * 70}")
print("SUMMARY")
print(f"{'=' * 70}")
print(f"\n{'Emotion':<12} {'Correct':<10} {'Total':<10} {'Accuracy':<10}")
print(f"{'─' * 42}")
for emotion, res in results_by_emotion.items():
    print(f"{emotion:<12} {res['correct']:<10} {res['total']:<10} {res['accuracy']:.0f}%")

overall_accuracy = (correct / total) * 100
print(f"{'─' * 42}")
print(f"{'OVERALL':<12} {correct:<10} {total:<10} {overall_accuracy:.0f}%")
print(f"\nClassifier {'PASSED' if overall_accuracy >= 70 else 'NEEDS RETRAINING'} (threshold: 70%)")
