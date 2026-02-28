require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Try different ways to import pdf-parse
let pdfParse;
try {
  // CommonJS import
  pdfParse = require("pdf-parse");
  console.log("✅ pdf-parse loaded (CommonJS)");
} catch (e) {
  try {
    // Some versions export as default
    pdfParse = require("pdf-parse").default;
    console.log("✅ pdf-parse loaded (default export)");
  } catch (e2) {
    console.error("❌ Failed to load pdf-parse. Please run:");
    console.error("npm uninstall pdf-parse && npm install pdf-parse@1.1.1");
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA_BASE = process.env.OLLAMA_BASE || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const DOCS_DIR = path.join(__dirname, "..", "documents");

// Chunking configuration
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const MIN_CHUNK_LEN = 150;

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function chunkText(text) {
  const t = normalize(text);
  const chunks = [];
  let start = 0;

  while (start < t.length) {
    const end = Math.min(start + CHUNK_SIZE, t.length);
    const chunk = t.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LEN) chunks.push(chunk);
    if (end === t.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

async function ollamaEmbedBatch(inputs) {
  try {
    const embeddings = [];
    for (const input of inputs) {
      const preview = input.length > 50 ? input.substring(0, 50) + "..." : input;
      console.log(`   🔄 Embedding: "${preview}"`);
      
      const response = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          model: EMBED_MODEL, 
          prompt: input 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama embed failed: HTTP ${response.status}`);
      }
      const data = await response.json();
      embeddings.push(data.embedding);
    }
    return embeddings;
  } catch (error) {
    console.error(`❌ Ollama connection error:`, error.message);
    throw error;
  }
}

async function extractTextFromPDF(filePath) {
  const fileName = path.basename(filePath);
  console.log(`   📖 Extracting text from ${fileName}...`);
  
  try {
    const buffer = fs.readFileSync(filePath);
    
    // Try parsing with pdf-parse
    try {
      console.log(`   ⏳ Calling pdfParse with buffer of size: ${buffer.length} bytes`);
      
      // Make sure pdfParse is a function
      if (typeof pdfParse !== 'function') {
        console.log(`   ❌ pdfParse is not a function (type: ${typeof pdfParse})`);
        return "";
      }
      
      const data = await pdfParse(buffer);
      const text = data.text || "";
      
      console.log(`   ✅ Extracted ${text.length} characters`);
      
      // Check if we got real text (not binary garbage)
      const printableChars = (text.match(/[A-Za-z0-9\s\.,!?;:'"()-]/g) || []).length;
      const textRatio = text.length > 0 ? printableChars / text.length : 0;
      
      console.log(`   📊 Text quality: ${Math.round(textRatio * 100)}% readable`);
      
      if (textRatio > 0.3 && text.length > 100) {
        return text;
      } else {
        console.log(`   ⚠️ Low quality text (${Math.round(textRatio*100)}% readable)`);
        return "";
      }
    } catch (parseError) {
      console.log(`   ❌ PDF parse failed:`, parseError.message);
      return "";
    }
  } catch (error) {
    console.error(`   ❌ Failed to read PDF: ${error.message}`);
    return "";
  }
}

async function checkTableSchema() {
  try {
    const { data, error } = await supabase
      .from("chunks")
      .select("chunk_index")
      .limit(1);
    
    if (error && error.message.includes("column")) {
      return { hasChunkIndex: false };
    }
    return { hasChunkIndex: true };
  } catch (e) {
    return { hasChunkIndex: false };
  }
}

async function ingestOnePdf(filePath, hasChunkIndex) {
  const fileName = path.basename(filePath);
  const title = fileName.replace(/\.pdf$/i, "");

  console.log(`\n📄 --- Ingesting ${fileName} ---`);

  try {
    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);

    if (!text || text.length < 100) {
      console.log("⚠️  Could not extract text. This PDF may be:");
      console.log("   - A scanned/image-based PDF (needs OCR)");
      console.log("   - Password protected");
      console.log("   - Corrupted");
      console.log("\n   💡 Alternative: Convert this PDF to .txt file manually");
      console.log("      and place it in the documents folder.");
      return;
    }

    console.log(`   ✅ Successfully extracted ${text.length} characters`);

    // Create chunks
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      console.log("⚠️  No chunks produced.");
      return;
    }

    console.log(`   📚 Generated ${chunks.length} chunks`);
    console.log(`   📝 First chunk preview: "${chunks[0].substring(0, 100)}..."`);

    // Insert document record
    const { data: docData, error: docErr } = await supabase
      .from("documents")
      .insert([{ 
        title, 
        source_path: `documents/${fileName}`,
        created_at: new Date().toISOString()
      }])
      .select("id")
      .single();

    if (docErr) {
      throw new Error(`Documents insert failed: ${docErr.message}`);
    }
    
    const document_id = docData.id;
    console.log(`   🆔 Document ID: ${document_id}`);

    // Process chunks
    let successCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk_text = chunks[i];
      
      try {
        // Generate embedding
        const vectors = await ollamaEmbedBatch([chunk_text]);
        const embedding = vectors[0];

        // Prepare insert data
        const insertData = {
          document_id,
          chunk_text,
          embedding,
          created_at: new Date().toISOString()
        };
        
        if (hasChunkIndex) {
          insertData.chunk_index = i;
        }

        const { error: insErr } = await supabase
          .from("chunks")
          .insert(insertData);

        if (insErr) {
          console.error(`   ❌ Chunk ${i} insert failed:`, insErr.message);
          continue;
        }

        successCount++;
        
        if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
          console.log(`   ✅ Processed ${i + 1}/${chunks.length} chunks`);
        }
      } catch (chunkError) {
        console.error(`   ❌ Chunk ${i} failed:`, chunkError.message);
      }
    }

    console.log(`   ✅ Completed ${fileName} (${successCount}/${chunks.length} chunks successful)`);
    
  } catch (error) {
    console.error(`   ❌ Failed to process ${fileName}:`, error.message);
  }
}

async function main() {
  console.log("🚀 Starting PDF ingestion...");
  console.log("================================");

  if (!fs.existsSync(DOCS_DIR)) {
    console.error("❌ Documents folder not found:", DOCS_DIR);
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    console.log("   ✅ Created documents folder");
    process.exit(1);
  }

  const pdfs = fs.readdirSync(DOCS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map(f => path.join(DOCS_DIR, f));

  if (pdfs.length === 0) {
    console.error("❌ No PDF files found in documents/");
    process.exit(1);
  }

  console.log(`📚 Found ${pdfs.length} PDF file(s) to process`);
  
  // Verify connections
  try {
    await supabase.from("documents").select("count", { count: "exact", head: true });
    console.log("✅ Supabase connection verified");
  } catch (error) {
    console.error("❌ Supabase connection failed:", error.message);
    process.exit(1);
  }

  const { hasChunkIndex } = await checkTableSchema();
  console.log(`ℹ️  chunk_index column ${hasChunkIndex ? 'exists' : 'does not exist'}`);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!response.ok) throw new Error();
    console.log("✅ Ollama connection verified");
  } catch (error) {
    console.error("❌ Ollama connection failed");
    process.exit(1);
  }

  console.log("================================");

  for (const pdfFile of pdfs) {
    await ingestOnePdf(pdfFile, hasChunkIndex);
  }

  console.log("\n================================");
  console.log("✅ Ingestion complete!");
}

main().catch(console.error);