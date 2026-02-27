const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(cors());
app.use(express.json());
console.log("SERVER.JS LOADED: SAFETY_AND_RATELIMIT_ENABLED");

// Helps IP detection if Express is ever behind a proxy (safe for local demo)
app.set("trust proxy", true);

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3.2:3b";

/**
 * Rate limit for /chat
 * Final demo setting: 20 requests per minute per IP.
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,             // was 3 for testing; 20 is nicer for real use
  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    console.log(
      `[RATE_LIMIT] ${new Date().toISOString()} ip=${req.ip} path=${req.path}`
    );
    return res.status(429).json({
      ok: false,
      blocked: false,
      error: "Rate limit exceeded. Please wait a moment before sending more messages.",
    });
  },
});

/**
 * Safety gate middleware (blocks self-harm instruction attempts)
 */
function safetyGate(req, res, next) {
  if (req.path !== "/chat" || req.method !== "POST") return next();

  const msg = String(req.body?.message || "").toLowerCase().trim();
  if (!msg) {
    return res.status(400).json({
      ok: false,
      blocked: false,
      error: "Missing 'message' in body",
    });
  }

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

  const isBlocked = blockedPhrases.some((p) => msg.includes(p));

  if (isBlocked) {
    console.log(
      `[SAFETY_BLOCK] ${new Date().toISOString()} ip=${req.ip} path=${req.path}`
    );

    return res.status(200).json({
      ok: true,
      blocked: true,
      reply:
        "I’m really sorry you’re feeling this way, but I can’t help with self-harm instructions. " +
        "If you feel in immediate danger, please contact local emergency services right now. " +
        "If you can, reach out to someone you trust (a friend, family member, or counselor). " +
        "If you tell me what you’re going through, I can offer supportive coping steps.",
    });
  }

  next();
}

app.use(safetyGate);

app.post("/chat", chatLimiter, async (req, res) => {
  try {
    const message = String(req.body?.message || "");

    const r = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: message,
        stream: false,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({
        ok: false,
        blocked: false,
        error: "Ollama error",
        detail: text,
      });
    }

    const data = await r.json();
    return res.json({ ok: true, blocked: false, reply: data.response });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      blocked: false,
      error: String(e),
    });
  }
});

app.listen(3001, () => console.log("Local AI server: http://localhost:3001"));
