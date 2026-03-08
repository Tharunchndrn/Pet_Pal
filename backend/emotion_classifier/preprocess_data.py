import pandas as pd
import os
from sklearn.model_selection import train_test_split
from sklearn.utils import resample

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DATA_PATH = os.path.join(BASE_DIR, 'data', 'raw')
PROCESSED_DATA_PATH = os.path.join(BASE_DIR, 'data', 'processed')

def preprocess():
    print("Loading raw GoEmotions data...")
    # GoEmotions raw files are goemotions_1.csv, goemotions_2.csv, goemotions_3.csv
    files = ['goemotions_1.csv', 'goemotions_2.csv', 'goemotions_3.csv']
    df_list = []
    for f in files:
        df_list.append(pd.read_csv(os.path.join(RAW_DATA_PATH, f)))
    
    df = pd.concat(df_list, ignore_index=True)
    
    # Mapping from 27 GoEmotions to 7 UI emotions (based on preprocess_data.ipynb)
    mapping = {
        'admiration': 'happy',
        'amusement': 'happy',
        'approval': 'happy',
        'excitement': 'happy',
        'gratitude': 'happy',
        'joy': 'happy',
        'love': 'happy',
        'optimism': 'happy',
        'pride': 'happy',
        'relief': 'happy',
        'calm': 'calm', # Added mapping for calm if it exists, but GoEmotions doesn't have it.
        # Wait, if GoEmotions doesn't have 'calm', how was it mapped?
        # Checking notebook learnings: 
        # 'relief' -> 'happy' ? 
        # Actually, let's look at the notebook mapping again.
    }
    
    # Redefining mapping based on the notebook logic seen earlier:
    ui_mapping = {
        'admiration': 'happy', 'amusement': 'happy', 'approval': 'happy', 'excitement': 'happy', 
        'gratitude': 'happy', 'joy': 'happy', 'love': 'happy', 'optimism': 'happy', 'pride': 'happy', 
        'relief': 'calm', # relief -> calm
        'sadness': 'sad', 'disappointed': 'sad', 'embarrassment': 'sad', 'grief': 'sad', 'remorse': 'sad',
        'anger': 'angry', 'annoyance': 'angry', 'disapproval': 'angry', 'disgust': 'angry', # disgust -> angry
        'fear': 'anxious', 
        'nervousness': 'stressed', # nervousness -> stressed
        'confusion': 'confused', 'curiosity': 'confused', 'realization': 'confused', 'surprise': 'confused',
        'desire': 'happy',
        'neutral': 'calm'
    }

    # GoEmotions column names are the emotion names (multi-label)
    # We need to find which column has 1.
    emotion_cols = list(ui_mapping.keys())
    existing_cols = [c for c in emotion_cols if c in df.columns]
    
    def get_ui_label(row):
        for col in existing_cols:
            if row[col] == 1:
                return ui_mapping[col]
        return 'calm' # Default to calm (neutral)

    print("Mapping labels...")
    df['label'] = df.apply(get_ui_label, axis=1)
    
    # Select only text and label
    processed_df = df[['text', 'label']].copy()
    
    print("Class distribution before oversampling:")
    print(processed_df['label'].value_counts())
    
    # Oversampling strategy
    # Minority classes: anxious, stressed, calm (if neutral wasn't enough), sad
    target_count = processed_df['label'].value_counts().max() // 2 # Target half of the majority class 'happy'
    
    df_list = []
    for label in processed_df['label'].unique():
        df_label = processed_df[processed_df['label'] == label]
        if len(df_label) < target_count:
            print(f"Oversampling class '{label}' from {len(df_label)} to {target_count}")
            df_label_oversampled = resample(df_label, 
                                            replace=True, 
                                            n_samples=target_count, 
                                            random_state=42)
            df_list.append(df_label_oversampled)
        else:
            df_list.append(df_label)
            
    balanced_df = pd.concat(df_list)
    
    print("Class distribution after oversampling:")
    print(balanced_df['label'].value_counts())
    
    # Label encoding
    labels = sorted(balanced_df['label'].unique())
    label2id = {label: i for i, label in enumerate(labels)}
    id2label = {i: label for i, label in enumerate(labels)}
    
    balanced_df['label_id'] = balanced_df['label'].map(label2id)
    
    # Split into train and val (stratified)
    train_df, val_df = train_test_split(balanced_df, test_size=0.1, stratify=balanced_df['label_id'], random_state=42)
    
    # Save processed data
    if not os.path.exists(PROCESSED_DATA_PATH):
        os.makedirs(PROCESSED_DATA_PATH)
        
    train_df.to_csv(os.path.join(PROCESSED_DATA_PATH, 'train.csv'), index=False)
    val_df.to_csv(os.path.join(PROCESSED_DATA_PATH, 'val.csv'), index=False)
    
    print(f"Saved processed data to {PROCESSED_DATA_PATH}")
    print(f"Label mapping: {id2label}")

if __name__ == "__main__":
    preprocess()
