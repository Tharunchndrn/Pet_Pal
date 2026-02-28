const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

async function embedOne(text) {
  const r = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`ollama embeddings failed: ${r.status}`);
  const j = await r.json();
  return j.embedding;
}

async function main() {
  const { data: rows, error } = await supabase
    .from("chunks")
    .select("id, chunk_text")
    .is("embedding", null);

  if (error) throw new Error(error.message);
  console.log("Rows to embed:", rows.length);

  for (const row of rows) {
    const vec = await embedOne(row.chunk_text);
    const { error: upErr } = await supabase.from("chunks").update({ embedding: vec }).eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    console.log("Embedded:", row.id, "dim=", vec.length);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
