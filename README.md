
## Tech (current dev setup)

**Backend / Auth / DB**
- Supabase (Auth + Database)
- (Edge Functions are in the project, but the AI call is currently local for development)

**AI (Local)**
- Ollama running locally on your laptop
- Model: `llama3.2:3b` [web:514]
- Ollama API: `http://localhost:11434`

**AI Proxy API (Local)**
- Node.js + Express server in `petchat-local-ai/`
- Endpoint: `POST http://localhost:3001/chat`
- This server forwards requests to Ollama `POST /api/generate` and returns `{ reply: "..." }` [web:347]

**Frontend**
- Vite dev server in `petchat-web/` (usually runs at `http://localhost:5173`) [web:511]

## How to run (local)

1) Start Ollama (make sure the model exists)
```bash
ollama pull llama3.2:3b
ollama list
```

2) Start the local AI proxy (port 3001)
```bash
cd petchat-local-ai
npm install
node server.js
```

3) Start the web app (Vite)
```bash
cd ../petchat-web
npm install
npm run dev
```

4) Test
- Open the Vite URL (example: http://localhost:5173) [web:511]
- Type a message and click Send
- You should see a JSON output like:
```json
{ "data": { "reply": "..." } }
```

## Notes
- This setup is for development/demo with local AI.
- Supabase Edge Functions in the cloud cannot call your laptop localhost, so we use the local Node proxy during dev.
---

# PetPal 🐾 — Emotion Intelligent Companion
PetPal is a supportive, emotionally intelligent AI pet companion designed to listen and provide empathetic support using real-time emotion detection.

## 🌟 Key Features
- **Emotion Intelligence**: Uses a custom-trained **RoBERTa-based** emotion classifier to detect how you're feeling.
- **Empathetic AI**: Adjusts its tone and conversation style based on your detected emotion (e.g., offering more support when you're sad).
- **Multi-Model Support**: Supports both local LLMs (Ollama) and cloud models (OpenRouter).

## 🧠 Emotion Classifier Details
The heart of PetPal's empathy is our custom emotion classification engine.

### How it Works
1.  **Detection**: Every user message is analyzed by a fine-tuned **RoBERTa** model (`distilroberta-base`).
2.  **Context Injection**: The detected emotion is injected into the AI's system prompt to shift its "personality" dynamically.
3.  **Supportive Advice**: The LLM uses this emotional context to provide tailored coping strategies.

### Detected Emotions
The classifier detects 7 core emotional states:
- 😊 **Happy** — Positive vibes and encouragement.
- 🧘 **Calm** — Relaxing and steady conversation.
- 😢 **Sad** — Deep empathy and comfort.
- 😠 **Angry** — De-escalation and listening.
- 😰 **Anxious** — Grounding techniques and reassurance.
- 😫 **Stressed** — Stress-relief tips and calm support.
- 🤔 **Confused** — Clarity and patience.

---

## 🛠️ Updated Tech Stack
### Backend (Python/FastAPI)
- **Framework**: FastAPI
- **LLM API**: OpenRouter (Mistral/Gemini/etc.)
- **ML Engine**: PyTorch + Hugging Face Transformers
- **Classifier**: Fine-tuned RoBERTa (`backend/emotion_classifier/emotion_model`)

---

## 🚀 How to Run the Python Backend
This backend handles the **Emotion Detection** and **OpenRouter** integration.

```bash
# Navigate to the backend folder
cd backend

# Install dependencies
pip install -r requirements.txt

# Setup environment variables in .env
# OPENROUTER_API_KEY=your_key_here

# Run the server
python main.py
```
The backend runs at `http://localhost:8000`.

---

## 📝 Training the Classifier
If you wish to re-train or inspect the emotion model:
- **Pre-processing**: `backend/emotion_classifier/preprocess_data.ipynb`
- **Training**: `backend/emotion_classifier/train_emotion.ipynb`
- **Inference Code**: `backend/emotion_classifier/classifier.py`

---

## 🏗️ Development Status
- [x] RoBERTa Emotion Classifier Integration
- [x] OpenRouter Empathetic Prompting
- [x] Supabase Auth & Storage
- [ ] Mobile App Version (In Progress)


