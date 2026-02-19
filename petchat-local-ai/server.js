const express = require("express")
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

app.post("/chat", async (req, res) => {
  const { message } = req.body

  const r = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama3.2:3b", prompt: message, stream: false }),
  })

  const data = await r.json()
  res.json({ reply: data.response })
})

app.listen(3001, () => console.log("Local AI server: http://localhost:3001"))
