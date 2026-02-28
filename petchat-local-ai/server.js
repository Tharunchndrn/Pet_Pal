console.log("SERVER VERSION: RAG_ENABLED_V2");

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.set("trust proxy", 1);

// Return JSON on bad JSON bodies (instead of HTML error page)
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }
  next(err);
});

// ---- RATE LIMIT ----
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.log(`[RATE_LIMIT] ${new Date().toISOString()} ip=${req.ip} path=${req.path}`);
      res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again in a minute." });
    },
  })
);

// ---- CONFIG ----
const OLLAMA_BASE = "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("ENV MISSING: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
}

// Server-side Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- SAFETY GATE ----
const blockedPhrases = [
  "how to kill myself",
  "kill myself",
  "suicide method",
  "how to commit suicide",
  "commit suicide",
  "harm myself",
  "self harm",
  "cut myself",
  "overdose",
  "ways to die",
];

function safetyGate(req, res, next) {
  if (req.path !== "/chat" || req.method !== "POST") return next();

  const msg = String(req.body?.message || "").toLowerCase().trim();
  if (!msg) {
    return res.status(400).json({ ok: false, error: "Missing 'message'" });
  }

  const isBlocked = blockedPhrases.some((p) => msg.includes(p));
  if (isBlocked) {
    console.log(`[SAFETY_BLOCK] ${new Date().toISOString()} ip=${req.ip}`);
    return res.status(200).json({
      ok: true,
      blocked: true,
      reply:
        "I’m really sorry you’re feeling this way. I can’t help with self-harm instructions. " +
        "If you’re in immediate danger, contact local emergency services or someone you trust right now. " +
        "If you want, tell me what’s going on and I can offer supportive coping steps.",
      rag: { used: 0, sources: [] },
    });
  }

  next();
}
app.use(safetyGate);

// ---- HELPERS ----
async function ollamaEmbeddings(text) {
  const r = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });

  if (!r.ok) throw new Error(`ollama embeddings failed: HTTP ${r.status}`);
  const j = await r.json();

  if (!Array.isArray(j.embedding)) throw new Error("ollama embeddings: missing embedding array");
  return j.embedding;
}

async function retrieveTopChunks(queryVec, k = 3) {
  // Supabase RPC named parameters must match your SQL function args
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryVec,
    match_count: k,
  });

  if (error) throw new Error(`match_chunks RPC error: ${error.message}`);
  return data || [];
}

function buildPrompt(userMessage, chunks) {
  const context = chunks
    .map((c, i) => `Source ${i + 1} (sim ${Number(c.similarity).toFixed(3)}):\n${c.chunk_text}`)
    .join("\n\n");

  return `
You are PetChat, a supportive emotional-support assistant.
You are not a therapist. Encourage professional help when appropriate.
Use the CONTEXT when relevant. If context is not relevant, answer normally.

CONTEXT:
${context || "(no relevant context found)"}

USER:
${userMessage}
`.trim();
}

async function ollamaGenerate(prompt) {
  // Ollama /api/generate supports stream=false to return one JSON response. [web:111]
  const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.6 },
    }),
  });

  if (!r.ok) throw new Error(`ollama generate failed: HTTP ${r.status}`);
  const j = await r.json();
  return j.response || "";
}

// ---- HEALTH (debug) ----
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "RAG_ENABLED_V2",
    chat_model: CHAT_MODEL,
    embed_model: EMBED_MODEL,
    supabase_url_set: Boolean(SUPABASE_URL),
    supabase_key_set: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  });
});

// ---- ROUTE ----
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "Missing message" });
    }

    console.log(`[CHAT] ${new Date().toISOString()} ip=${req.ip} len=${message.length}`);

    // 1) Embed user message
    const qVec = await ollamaEmbeddings(message);
    console.log(`[RAG] embed_dim=${qVec.length}`);

    // 2) Retrieve chunks
    const chunks = await retrieveTopChunks(qVec, 3);
    console.log(`[RAG] chunks_found=${chunks.length}`);

    // 3) Generate reply using RAG context
    const prompt = buildPrompt(message, chunks);
    const reply = await ollamaGenerate(prompt);

    // 4) Return reply + RAG info
    return res.json({
      ok: true,
      blocked: false,
      reply,
      rag: {
        used: chunks.length,
        sources: chunks.map((c) => ({
          chunk_id: c.chunk_id,
          document_id: c.document_id,
          similarity: c.similarity,
        })),
      },
    });
  } catch (e) {
    console.error("[ERROR]", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
      rag: { used: 0, sources: [] },
    });
  }
});

// ---- START ----
app.listen(3001, () => console.log("Local AI server: http://localhost:3001"));
