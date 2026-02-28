require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

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
      console.log(`   🔄 Generating embedding...`);
      
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

async function ingestOneTextFile(filePath, hasChunkIndex) {
  const fileName = path.basename(filePath);
  const title = fileName.replace(/\.txt$/i, "");

  console.log(`\n📄 --- Ingesting ${fileName} ---`);

  try {
    // Read text file
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`   ✅ Read ${content.length} characters`);

    // Create chunks
    const chunks = chunkText(content);
    if (chunks.length === 0) {
      console.log("⚠️  No chunks produced.");
      return;
    }

    console.log(`   📚 Generated ${chunks.length} chunks`);
    console.log(`   📝 Preview: "${chunks[0].substring(0, 100)}..."`);

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
      try {
        // Generate embedding
        const vectors = await ollamaEmbedBatch([chunks[i]]);
        const embedding = vectors[0];

        // Prepare insert data
        const insertData = {
          document_id,
          chunk_text: chunks[i],
          embedding,
          created_at: new Date().toISOString()
        };
        
        if (hasChunkIndex) {
          insertData.chunk_index = i;
        }

        // Insert chunk
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
  console.log("🚀 Starting TEXT file ingestion...");
  console.log("================================");

  if (!fs.existsSync(DOCS_DIR)) {
    console.error("❌ Documents folder not found:", DOCS_DIR);
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    console.log("   ✅ Created documents folder");
    process.exit(1);
  }

  // Get all text files
  const txtFiles = fs.readdirSync(DOCS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .map(f => path.join(DOCS_DIR, f));

  if (txtFiles.length === 0) {
    console.error("❌ No text files found in documents/");
    console.log("\n   📝 Instructions:");
    console.log("   1. Open each PDF in your browser or PDF reader");
    console.log("   2. Press Ctrl+A to select all text");
    console.log("   3. Press Ctrl+C to copy");
    console.log("   4. Create a new .txt file in the documents folder");
    console.log("   5. Press Ctrl+V to paste the text");
    console.log("   6. Save the file");
    process.exit(1);
  }

  console.log(`📚 Found ${txtFiles.length} text file(s) to process`);
  
  // Verify Supabase connection
  try {
    const { error } = await supabase.from("documents").select("count", { count: "exact", head: true });
    if (error) throw error;
    console.log("✅ Supabase connection verified");
  } catch (error) {
    console.error("❌ Supabase connection failed:", error.message);
    process.exit(1);
  }

  // Check table schema
  const { hasChunkIndex } = await checkTableSchema();
  console.log(`ℹ️  chunk_index column ${hasChunkIndex ? 'exists' : 'does not exist'}`);

  // Verify Ollama connection
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!response.ok) throw new Error();
    console.log("✅ Ollama connection verified");
  } catch (error) {
    console.error("❌ Ollama connection failed. Make sure Ollama is running");
    process.exit(1);
  }

  console.log("================================");

  // Process each text file
  for (const txtFile of txtFiles) {
    await ingestOneTextFile(txtFile, hasChunkIndex);
  }

  console.log("\n================================");
  console.log("✅ Ingestion complete!");
  console.log("   Now you can test with:");
  console.log('   curl.exe -X POST http://localhost:3001/chat -H "Content-Type: application/json" -d "{\\"message\\":\\"anxiety\\"}"');
}

main().catch(console.error);
