import os
import pandas as pd
import torch
from torch import nn
from transformers import (
    AutoTokenizer, 
    AutoModelForSequenceClassification, 
    Trainer, 
    TrainingArguments,
    DataCollatorWithPadding
)
from sklearn.metrics import f1_score, accuracy_score, classification_report
import numpy as np

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROCESSED_DATA_PATH = os.path.join(BASE_DIR, 'data', 'processed')
MODEL_OUTPUT_DIR = os.path.join(BASE_DIR, 'emotion_model_v2') # New version

# Hyperparameters
MODEL_NAME = "distilroberta-base"
MAX_LENGTH = 128
BATCH_SIZE = 16
EPOCHS = 3
LEARNING_RATE = 2e-5

class EmotionDataset(torch.utils.data.Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __getitem__(self, idx):
        item = {key: torch.tensor(val[idx]) for key, val in self.encodings.items()}
        item['labels'] = torch.tensor(self.labels[idx])
        return item

    def __len__(self):
        return len(self.labels)

class WeightedTrainer(Trainer):
    def __init__(self, class_weights, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Explicitly cast to float32 to match model weights
        self.class_weights = torch.tensor(class_weights, dtype=torch.float32).to(self.args.device)

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.get("labels")
        # forward pass
        outputs = model(**inputs)
        logits = outputs.get("logits")
        # compute custom loss
        loss_fct = nn.CrossEntropyLoss(weight=self.class_weights)
        loss = loss_fct(logits.view(-1, self.model.config.num_labels), labels.view(-1))
        return (loss, outputs) if return_outputs else loss

def compute_metrics(pred):
    labels = pred.label_ids
    preds = pred.predictions.argmax(-1)
    f1 = f1_score(labels, preds, average='macro')
    acc = accuracy_score(labels, preds)
    return {
        'accuracy': acc,
        'f1': f1,
    }

def train():
    print("Loading processed data...")
    train_df = pd.read_csv(os.path.join(PROCESSED_DATA_PATH, 'train.csv'))
    val_df = pd.read_csv(os.path.join(PROCESSED_DATA_PATH, 'val.csv'))
    
    # Stratified Subsetting to handle CPU limitations
    # 1000 samples per class for training on CPU to finish in time
    MAX_SAMPLES_PER_CLASS = 1000 
    print(f"Subsetting data to {MAX_SAMPLES_PER_CLASS} samples per class for speed...")
    
    train_df = train_df.groupby('label').apply(lambda x: x.sample(min(len(x), MAX_SAMPLES_PER_CLASS), random_state=42)).reset_index(drop=True)
    val_df = val_df.groupby('label').apply(lambda x: x.sample(min(len(x), MAX_SAMPLES_PER_CLASS // 10), random_state=42)).reset_index(drop=True)
    
    print(f"New train size: {len(train_df)}")
    print(f"New val size: {len(val_df)}")

    # Get labels and calculate weights
    labels = sorted(train_df['label'].unique())
    num_labels = len(labels)
    label2id = {label: i for i, label in enumerate(labels)}
    id2label = {i: label for i, label in enumerate(labels)}
    
    # Calculate class weights
    class_counts = train_df['label_id'].value_counts().sort_index().values
    total_samples = len(train_df)
    # Inverse frequency weighting
    weights = total_samples / (num_labels * class_counts)
    print(f"Computed class weights: {dict(zip(labels, weights))}")
    
    print(f"Initializing tokenizer: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    
    print("Tokenizing data...")
    train_encodings = tokenizer(train_df['text'].tolist(), truncation=True, padding=True, max_length=MAX_LENGTH)
    val_encodings = tokenizer(val_df['text'].tolist(), truncation=True, padding=True, max_length=MAX_LENGTH)
    
    train_dataset = EmotionDataset(train_encodings, train_df['label_id'].tolist())
    val_dataset = EmotionDataset(val_encodings, val_df['label_id'].tolist())
    
    print(f"Loading model: {MODEL_NAME}")
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME, 
        num_labels=num_labels,
        id2label=id2label,
        label2id=label2id
    )
    
    training_args = TrainingArguments(
        output_dir='./results',
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE,
        warmup_steps=500,
        weight_decay=0.01,
        logging_dir='./logs',
        logging_steps=100,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        learning_rate=LEARNING_RATE,
        fp16=torch.cuda.is_available() # Use FP16 if GPU is available
    )
    
    trainer = WeightedTrainer(
        class_weights=weights,
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
        data_collator=DataCollatorWithPadding(tokenizer)
    )
    
    print("Starting training...")
    trainer.train()
    
    print(f"Saving model to {MODEL_OUTPUT_DIR}")
    trainer.save_model(MODEL_OUTPUT_DIR)
    tokenizer.save_pretrained(MODEL_OUTPUT_DIR)
    
    # Final evaluation
    print("Final evaluation...")
    results = trainer.evaluate()
    print(results)
    
    # Detailed report
    preds_output = trainer.predict(val_dataset)
    preds = np.argmax(preds_output.predictions, axis=-1)
    print("\nClassification Report:")
    print(classification_report(val_df['label_id'], preds, target_names=labels))

if __name__ == "__main__":
    train()
