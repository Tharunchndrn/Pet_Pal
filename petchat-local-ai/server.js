console.log("SERVER VERSION: RAG_EMOTION_ENABLED_V2");

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.set("trust proxy", 1);

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }
  next(err);
});

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

const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const EMOTION_API_URL = process.env.EMOTION_API_URL || "http://localhost:8001";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("ENV MISSING: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
      emotion: "unknown",
      reply:
        "I'm really sorry you're feeling this way. I can't help with self-harm instructions. " +
        "If you're in immediate danger, contact local emergency services or someone you trust right now. " +
        "If you want, tell me what's going on and I can offer supportive coping steps.",
      rag: { used: 0, sources: [] },
    });
  }

  next();
}
app.use(safetyGate);

function buildEmotionGuideline(emotion) {
  const guidelines = {
    happy:
      "The user is feeling happy and positive. Reinforce their good mood warmly. " +
      "Celebrate with them and encourage them to build on what is going well. " +
      "You can suggest ways to maintain this positive state.",
    calm:
      "The user is feeling calm and grounded. Match their balanced tone. " +
      "Provide thoughtful, measured support. This is a good time to discuss " +
      "coping strategies or reflection exercises if relevant.",
    sad:
      "The user is feeling sad. Be very warm, gentle, and validating. " +
      "Do not rush to fix or minimize their feelings. Acknowledge their pain first. " +
      "Offer comfort before suggestions. Gently encourage connection with others or professional help if needed.",
    angry:
      "The user is feeling angry or frustrated. Acknowledge their frustration first " +
      "before offering any suggestions. Do not dismiss or argue with their feelings. " +
      "Use de-escalating language. Help them feel heard before moving to problem-solving.",
    anxious:
      "The user is feeling anxious. Use calm, reassuring language. " +
      "Offer grounding techniques such as deep breathing, the 5-4-3-2-1 senses exercise, " +
      "or gentle reassurance that anxiety is manageable. Avoid overwhelming them with too much information.",
    stressed:
      "The user is feeling stressed and overwhelmed. Acknowledge how much they are carrying. " +
      "Offer practical, small coping steps rather than big solutions. " +
      "Encourage them to break tasks into smaller parts and remind them that rest is important. " +
      "Suggest professional support if stress seems severe.",
    confused:
      "The user is feeling confused or lost. Be very clear, patient, and structured. " +
      "Break information into simple steps. Avoid jargon. " +
      "Gently help them identify what is unclear and guide them one step at a time.",
  };

  return (
    guidelines[emotion] ||
    "Be empathetic, warm, and non-judgmental. Support the user with care and suggest professional help if needed."
  );
}

async function detectEmotion(message) {
  try {
    const r = await fetch(`${EMOTION_API_URL}/predict-emotion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!r.ok) return "unknown";
    const data = await r.json();
    return data.emotion || "unknown";
  } catch (err) {
    console.warn("[EMOTION] service unavailable, defaulting to unknown:", err.message);
    return "unknown";
  }
}

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
  const chunks = await retrieveTopChunks(qVec, 3);
  console.log(`[RAG] chunks_found=${chunks.length}`);
  // ADD THIS LINE:
  chunks.forEach((c, i) => console.log(`[CHUNK ${i+1}] sim=${c.similarity} text=${c.chunk_text?.slice(0,150)}`));

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryVec,
    match_count: k,
  });

  if (error) throw new Error(`match_chunks RPC error: ${error.message}`);
  return data || [];
}

// ---- FIXED: strict RAG prompt ----
function buildPrompt(userMessage, chunks, emotion) {
  const emotionGuideline = buildEmotionGuideline(emotion);

  if (chunks.length > 0) {
    const context = chunks
      .map((c, i) => `[Source ${i + 1}]:\n${c.chunk_text}`)
      .join("\n\n");

    return `
You are PetChat, a supportive emotional-support assistant for mental health and wellbeing.
You are not a therapist or doctor. Always encourage professional help for serious concerns.

DETECTED EMOTION: ${emotion || "unknown"}

HOW TO RESPOND BASED ON THIS EMOTION:
${emotionGuideline}

IMPORTANT INSTRUCTION:
You have been provided with CONTEXT from the knowledge base below.
You MUST use this context to answer the user's question.
Quote or reference the context directly where applicable.
Do NOT say you cannot find information if it is present in the context.
Do NOT use outside knowledge if the context answers the question.

CONTEXT FROM KNOWLEDGE BASE:
${context}

USER MESSAGE:
${userMessage}

Answer using the context above:
`.trim();
  }

  // No chunks found — fall back to general support
  return `
You are PetChat, a supportive emotional-support assistant for mental health and wellbeing.
You are not a therapist or doctor. Always encourage professional help for serious concerns.

DETECTED EMOTION: ${emotion || "unknown"}

HOW TO RESPOND BASED ON THIS EMOTION:
${emotionGuideline}

GENERAL GUIDELINES:
- Be warm, empathetic, and non-judgmental at all times.
- Keep responses concise, clear, and supportive.
- Never diagnose, prescribe, or make clinical judgments.

USER MESSAGE:
${userMessage}
`.trim();
}

async function ollamaGenerate(prompt) {
  const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.3 },
    }),
  });

  if (!r.ok) throw new Error(`ollama generate failed: HTTP ${r.status}`);
  const j = await r.json();
  return j.response || "";
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "RAG_EMOTION_ENABLED_V2",
    chat_model: CHAT_MODEL,
    embed_model: EMBED_MODEL,
    emotion_api: EMOTION_API_URL,
    supabase_url_set: Boolean(SUPABASE_URL),
    supabase_key_set: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  });
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "Missing message" });
    }

    console.log(`[CHAT] ${new Date().toISOString()} ip=${req.ip} len=${message.length}`);

    const emotion = await detectEmotion(message);
    console.log(`[EMOTION] detected=${emotion}`);

    const qVec = await ollamaEmbeddings(message);
    console.log(`[RAG] embed_dim=${qVec.length}`);

    const chunks = await retrieveTopChunks(qVec, 3);
    console.log(`[RAG] chunks_found=${chunks.length}`);

    const prompt = buildPrompt(message, chunks, emotion);

    const reply = await ollamaGenerate(prompt);

    return res.json({
      ok: true,
      blocked: false,
      emotion,
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

app.listen(3001, () => console.log("Local AI server: http://localhost:3001"));
