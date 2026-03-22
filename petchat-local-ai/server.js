// ============================================================
//  PetChat Local AI Server  –  RAG_EMOTION_ENABLED_V4
//  Aligned to 7-class emotion classifier:
//  happy, calm, sad, angry, anxious, stressed, confused
// ============================================================
console.log("SERVER VERSION: RAG_EMOTION_ENABLED_V4");

const express  = require("express");
const cors     = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// ── Config ────────────────────────────────────────────────────
const OLLAMA_BASE     = process.env.OLLAMA_BASE        || "http://localhost:11434";
const CHAT_MODEL      = process.env.OLLAMA_CHAT_MODEL  || "llama3.2:3b";
const EMBED_MODEL     = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const EMOTION_API_URL = process.env.EMOTION_API_URL    || "http://localhost:8001";
const PORT            = parseInt(process.env.PORT, 10) || 3001;

const CRISIS_LINES = {
  primary:   "Sumithrayo Sri Lanka: +94 11 2692909",
  secondary: "CCCline: 1333",
  emergency: "Local emergency: 119",
};

// ── Supabase ──────────────────────────────────────────────────
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[WARN] SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY missing in .env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Express Setup ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);

app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") {
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

// ── Safety Gate ───────────────────────────────────────────────
const HARD_BLOCKED_PHRASES = [
  "how to kill myself",
  "suicide method",
  "how to commit suicide",
  "how to end my life",
  "ways to die",
  "how to harm myself",
  "how to cut myself",
  "how to overdose",
];

const CRISIS_PHRASES = [
  "kill myself",
  "commit suicide",
  "want to die",
  "end my life",
  "harm myself",
  "self harm",
  "cut myself",
  "overdose",
  "don't want to be here",
  "no point living",
  "not worth living",
];

function safetyGate(req, res, next) {
  if (req.path !== "/chat" || req.method !== "POST") return next();

  const msg = String(req.body?.message || "").toLowerCase().trim();
  if (!msg) {
    return res.status(400).json({ ok: false, error: "Missing 'message'" });
  }

  const isHardBlocked = HARD_BLOCKED_PHRASES.some((p) => msg.includes(p));
  if (isHardBlocked) {
    console.log(`[SAFETY_HARD_BLOCK] ${new Date().toISOString()} ip=${req.ip}`);
    return res.status(200).json({
      ok: true,
      blocked: true,
      crisis: true,
      emotion: "unknown",
      reply:
        "I'm really sorry you're feeling this way. I'm not able to help with that, but please reach out right now:\n\n" +
        `• ${CRISIS_LINES.primary}\n` +
        `• ${CRISIS_LINES.secondary}\n` +
        `• ${CRISIS_LINES.emergency}\n\n` +
        "You're not alone. If you want to talk about what's going on, I'm here.",
      rag: { used: 0, sources: [] },
    });
  }

  const isCrisis = CRISIS_PHRASES.some((p) => msg.includes(p));
  if (isCrisis) {
    console.log(`[SAFETY_CRISIS_FLAG] ${new Date().toISOString()} ip=${req.ip}`);
    req.isCrisis = true;
  }

  next();
}
app.use(safetyGate);

// ── Emotion Styles ─────────────────────────────────────────────
// Exactly 7 emotions matching the trained classifier output.
// Each entry defines tone, conversation behavior, and a
// few-shot example so the LLM imitates the right style.
const EMOTION_STYLES = {
  happy: {
    guideline:
      "The user is happy and positive. Match their energy lightly. " +
      "Be warm and genuine. Celebrate briefly without overdoing it.",
    tone: "upbeat, warm, brief",
    example: {
      user: "I'm feeling great today, everything is going well!",
      assistant: "That's really good to hear. Enjoy it — sounds like things are coming together for you.",
    },
  },
  calm: {
    guideline:
      "The user is calm and grounded. Match their settled energy. " +
      "Be thoughtful and measured. Gentle reflection is welcome if they're open to it.",
    tone: "steady, clear, grounded",
    example: {
      user: "I've been feeling pretty okay lately, just taking things slow.",
      assistant: "That sounds like a good place to be. Anything on your mind, or just checking in?",
    },
  },
  sad: {
    guideline:
      "The user is sad. Slow down. Acknowledge what they're feeling before anything else. " +
      "Don't rush to fix it. Warmth and validation come first. Keep words gentle and simple.",
    tone: "soft, warm, unhurried",
    example: {
      user: "I've just been feeling really down lately.",
      assistant: "I'm sorry you're going through that. That kind of low feeling can be really exhausting. Do you want to talk about what's been going on?",
    },
  },
  angry: {
    guideline:
      "The user is angry or frustrated. Don't argue or minimise. Acknowledge first, always. " +
      "Use calm, steady language. Help them feel heard before anything else.",
    tone: "calm, validating, steady",
    example: {
      user: "I'm just so fed up with everything right now.",
      assistant: "That sounds really frustrating. Sometimes everything just piles up at once. What's been getting to you the most?",
    },
  },
  anxious: {
    guideline:
      "The user is anxious. Be calm and reassuring. Short, simple messages work better — " +
      "don't overwhelm them. Offer one grounding idea at a time, not a list.",
    tone: "calm, gentle, simple",
    example: {
      user: "I've been feeling really anxious and can't stop worrying.",
      assistant: "Try this — breathe in for 4 counts, hold for 2, out for 6. Just that alone can settle things a bit. What's been on your mind?",
    },
  },
  stressed: {
    guideline:
      "The user is stressed and carrying a lot. Acknowledge the weight first. " +
      "Offer one small, practical step — not a full plan. Keep it manageable.",
    tone: "grounded, practical, supportive",
    example: {
      user: "I'm so stressed, I don't even know where to start.",
      assistant: "When everything feels like too much, just pick the one smallest thing you can do right now. What feels most urgent to you?",
    },
  },
  confused: {
    guideline:
      "The user feels lost or confused. Be clear, patient, and structured. " +
      "One idea at a time. Use plain language and guide gently.",
    tone: "clear, patient, simple",
    example: {
      user: "I don't really know what I'm feeling or what to do.",
      assistant: "That's okay — sometimes things just feel murky. Let's slow it down. Can you tell me a bit about what's been happening?",
    },
  },
};

// Fallback for "unknown" or any unexpected classifier output
const DEFAULT_STYLE = {
  guideline:
    "Be empathetic, warm, and non-judgmental. Support the user with care. " +
    "Suggest professional help for serious concerns.",
  tone: "warm, supportive, calm",
  example: {
    user: "I've just been feeling off lately.",
    assistant: "Sorry to hear that. Do you want to talk about what's been going on?",
  },
};

function getEmotionStyle(emotion) {
  return EMOTION_STYLES[emotion] || DEFAULT_STYLE;
}

// ── Emotion Detection ─────────────────────────────────────────
async function detectEmotion(message) {
  try {
    const r = await fetch(`${EMOTION_API_URL}/predict-emotion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!r.ok) return "unknown";
    const data = await r.json();
    // Validate that returned emotion is one of the 7 trained classes
    const VALID_EMOTIONS = ["happy", "calm", "sad", "angry", "anxious", "stressed", "confused"];
    const emotion = data.emotion || "unknown";
    return VALID_EMOTIONS.includes(emotion) ? emotion : "unknown";
  } catch (err) {
    console.warn("[EMOTION] service unavailable:", err.message);
    return "unknown";
  }
}

// ── Ollama Helpers ────────────────────────────────────────────
async function ollamaEmbeddings(text) {
  const r = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`ollama embeddings: HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.embedding)) throw new Error("ollama embeddings: missing array");
  return j.embedding;
}

async function ollamaGenerate(prompt) {
  const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.7, top_p: 0.9 },
    }),
  });
  if (!r.ok) throw new Error(`ollama generate: HTTP ${r.status}`);
  const j = await r.json();
  return j.response || "";
}

// ── Supabase RAG Retrieval ────────────────────────────────────
async function retrieveTopChunks(queryVec, k = 4) {
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryVec,
    match_count: k,
  });
  if (error) throw new Error(`match_chunks RPC error: ${error.message}`);
  return data || [];
}

// ── Prompt Builder ────────────────────────────────────────────
function buildPrompt({ userMessage, chunks, emotion, isCrisis }) {
  const style = getEmotionStyle(emotion);

  const crisisNote = isCrisis
    ? `\nCRISIS NOTE:\nThis person may be in real distress. Lead with empathy and warmth. ` +
      `Never provide harmful information. After your empathetic reply, gently share:\n` +
      `• ${CRISIS_LINES.primary}\n• ${CRISIS_LINES.secondary}\n• ${CRISIS_LINES.emergency}\n`
    : "";

  const styleRules = `
STYLE RULES — FOLLOW EXACTLY:
- You are a warm, calm human supporter — not a chatbot, therapist, or helpdesk agent.
- Sound like a real person in a chat conversation, not a scripted assistant.
- Default reply: 2 to 4 sentences only. Go longer only if the user asks for steps.
- No bullet points or numbered lists unless the user specifically asks for steps.
- Use contractions naturally: you're, it's, that's, don't, I'm.
- Never use these robotic phrases: "I understand how you feel", "I'm here for you", "Would you like me to", "Great question".
- Never start a reply with "I".
- Never end every reply with a question — only ask one if it genuinely helps.
- Never say what emotion the user is feeling out loud (e.g. don't say "I can see you're stressed").
- Use the detected emotion only to shape your tone quietly — don't announce it.
- Give only 1 coping idea at a time, not a full plan.
- When using knowledge base content, weave it naturally — never say "According to Source 1" or "the context says".`;

  const toneGuide = `TONE FOR THIS RESPONSE: ${style.tone}
BEHAVIOUR GUIDE: ${style.guideline}`;

  const fewShotExample = `
EXAMPLE OF THE RIGHT TONE:
User: ${style.example.user}
Assistant: ${style.example.assistant}`;

  const baseInstructions = `You are PetChat — a supportive, human-sounding wellbeing companion.
You are not a doctor or therapist. You encourage professional help for serious concerns.

DETECTED EMOTION: ${emotion || "unknown"}

${toneGuide}
${crisisNote}
${styleRules}
${fewShotExample}`.trim();

  if (chunks.length > 0) {
    const context = chunks.map((c) => c.chunk_text).join("\n\n---\n\n");

    return `
${baseInstructions}

KNOWLEDGE BASE:
Use this naturally if it helps. Don't reference it as "the context" or "source".
Do NOT say you can't find information if the answer is here.

${context}

USER MESSAGE:
${userMessage}

Reply as PetChat. Keep it short, warm, and human.
`.trim();
  }

  return `
${baseInstructions}

USER MESSAGE:
${userMessage}

Reply as PetChat. Keep it short, warm, and human.
`.trim();
}

// ── Routes ────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "RAG_EMOTION_ENABLED_V4",
    chat_model: CHAT_MODEL,
    embed_model: EMBED_MODEL,
    emotion_api: EMOTION_API_URL,
    supported_emotions: ["happy", "calm", "sad", "angry", "anxious", "stressed", "confused"],
    supabase_url_set: Boolean(SUPABASE_URL),
    supabase_key_set: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    crisis_lines: CRISIS_LINES,
  });
});

app.post("/chat", async (req, res) => {
  const startTime = Date.now();

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ ok: false, error: "Missing or empty 'message'" });
    }

    console.log(`[CHAT] ${new Date().toISOString()} ip=${req.ip} len=${message.length}`);

    // Run emotion detection and embedding in parallel for speed
    const [emotion, qVec] = await Promise.all([
      detectEmotion(message),
      ollamaEmbeddings(message),
    ]);

    console.log(`[EMOTION] detected=${emotion}`);
    console.log(`[RAG] embed_dim=${qVec.length}`);

    const chunks = await retrieveTopChunks(qVec, 4);
    console.log(`[RAG] chunks_found=${chunks.length}`);
    chunks.forEach((c, i) =>
      console.log(
        `[CHUNK ${i + 1}] sim=${c.similarity?.toFixed(4)} doc=${c.document_id} ` +
        `text=${String(c.chunk_text || "").slice(0, 120)}...`
      )
    );

    const prompt = buildPrompt({
      userMessage: message,
      chunks,
      emotion,
      isCrisis: req.isCrisis || false,
    });

    let reply = await ollamaGenerate(prompt);
    reply = reply.trim().replace(/\n{3,}/g, "\n\n");

    const elapsed = Date.now() - startTime;
    console.log(`[DONE] ${elapsed}ms`);

    return res.json({
      ok: true,
      blocked: false,
      crisis: req.isCrisis || false,
      emotion,
      reply,
      rag: {
        used: chunks.length,
        sources: chunks.map((c) => ({
          chunk_id:    c.chunk_id,
          document_id: c.document_id,
          similarity:  c.similarity,
        })),
      },
      meta: { elapsed_ms: elapsed },
    });

  } catch (e) {
    console.error("[ERROR]", e);
    return res.status(500).json({
      ok: false,
      error: process.env.NODE_ENV === "production" ? "Internal server error" : String(e),
      rag: { used: 0, sources: [] },
    });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`PetChat AI server running → http://localhost:${PORT}`)
);
