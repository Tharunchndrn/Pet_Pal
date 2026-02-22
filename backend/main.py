import os
import logging
import requests
import json
from fastapi import FastAPI, HTTPException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "mistralai/mistral-small-3.1-24b-instruct:free")

app = FastAPI()

# Enable CORS for frontend (file:// or any host)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    message: str

@app.get("/")
def root():
    return {"status": "ok", "message": "PetPal backend running. POST /chat to chat."}

@app.post("/chat")
async def chat(chat_message: ChatMessage):
    if not OPENROUTER_API_KEY:
        logger.error("OPENROUTER_API_KEY is not set in .env")
        raise HTTPException(status_code=500, detail="OpenRouter API key not configured. Add OPENROUTER_API_KEY to backend/.env")

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            data=json.dumps({
                "model": OPENROUTER_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": chat_message.message
                    }
                ]
            })
        )
        
        if response.status_code != 200:
            logger.error("OpenRouter API error: %s %s", response.status_code, response.text[:500])
            raise HTTPException(status_code=response.status_code, detail=response.text)
            
        data = response.json()
        bot_message = data['choices'][0]['message']['content']
        
        return {"response": bot_message}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
