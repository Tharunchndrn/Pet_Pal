
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
```
