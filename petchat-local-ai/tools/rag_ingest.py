import os, json, requests
from PyPDF2 import PdfReader
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"

CHUNK_SIZE = 750
CHUNK_OVERLAP = 150

def extract_pdf_text(path):
    reader = PdfReader(path)
    parts = []
    for p in reader.pages:
        t = p.extract_text() or ""
        parts.append(t)
    return "\n".join(parts)

def chunk_text(text, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    text = " ".join(text.split())
    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        chunk = text[start:end].strip()
        if len(chunk) >= 120:
            chunks.append(chunk)
        start = end - overlap
        if start < 0:
            start = 0
        if end == n:
            break
    return chunks

def embed(text):
    r = requests.post(OLLAMA_EMBED_URL, json={"model": EMBED_MODEL, "prompt": text}, timeout=120)
    r.raise_for_status()
    j = r.json()
    return j["embedding"]

def ingest_pdf(pdf_path, title=None):
    title = title or os.path.basename(pdf_path)
    source_path = pdf_path

    full_text = extract_pdf_text(pdf_path)
    chunks = chunk_text(full_text)

    doc = supabase.table("documents").insert({
        "title": title,
        "source_path": source_path
    }).execute().data[0]

    for i, ch in enumerate(chunks):
        vec = embed(ch)
        supabase.table("chunks").insert({
            "document_id": doc["id"],
            "chunk_text": ch,
            "embedding": vec
        }).execute()

    return {"document_id": doc["id"], "chunks": len(chunks)}

if __name__ == "__main__":
    docs_dir = "documents"
    for fn in os.listdir(docs_dir):
        if fn.lower().endswith(".pdf"):
            path = os.path.join(docs_dir, fn)
            result = ingest_pdf(path, title=fn.replace(".pdf", ""))
            print("Ingested:", result)
