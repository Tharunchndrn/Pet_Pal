import './style.css'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Local AI server (Node -> Ollama)
const LOCAL_AI_URL = 'http://localhost:3001/chat'

document.querySelector('#app').innerHTML = `
  <div class="container">
    <h2 class="title">PetChat Web (Test UI)</h2>

    <div class="grid">
      <div class="card">
        <h3>Auth</h3>
        <input class="input" id="email" placeholder="Email" />
        <input class="input" id="password" type="password" placeholder="Password" />
        <div class="row">
          <button class="btn" id="signup">Sign up</button>
          <button class="btn primary" id="signin">Sign in</button>
          <button class="btn" id="signout">Sign out</button>
          <button class="btn" id="session">Check session</button>
        </div>
      </div>

      <div class="card">
        <h3>Local AI (Ollama)</h3>
        <div class="label">Endpoint: <code>${LOCAL_AI_URL}</code></div>
        <input class="input" id="msg" placeholder="Message" />
        <div class="row">
          <button class="btn primary" id="call">Send</button>
        </div>
      </div>
    </div>

    <div class="outputTitle">Output</div>
    <pre class="output" id="out"></pre>
  </div>
`

const outEl = document.querySelector('#out')
const out = (obj) => { outEl.textContent = JSON.stringify(obj, null, 2) }

async function checkSession() {
  const { data, error } = await supabase.auth.getSession()
  out({ session: data?.session ? { user: data.session.user.email } : null, error })
}

async function getOrCreateConversationId(userId) {
  const { data: conv, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (selErr) return { conversation_id: null, error: selErr }

  if (conv?.id) return { conversation_id: conv.id, error: null }

  const { data: newConv, error: insErr } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title: 'My Chat' })
    .select('id')
    .single()

  if (insErr) return { conversation_id: null, error: insErr }
  return { conversation_id: newConv.id, error: null }
}

async function loadHistory(conversation_id) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true })

  return { data, error }
}

document.querySelector('#signup').onclick = async () => {
  const email = document.querySelector('#email').value
  const password = document.querySelector('#password').value
  const { data, error } = await supabase.auth.signUp({ email, password })
  out({ data, error })
}

document.querySelector('#signin').onclick = async () => {
  const email = document.querySelector('#email').value
  const password = document.querySelector('#password').value
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  out({ data, error })
}

document.querySelector('#signout').onclick = async () => {
  const { error } = await supabase.auth.signOut()
  out({ ok: true, error })
}

document.querySelector('#session').onclick = checkSession

document.querySelector('#call').onclick = async () => {
  try {
    const message = document.querySelector('#msg').value || 'hi'

    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      out({ ok: false, error: "Please sign in first", userErr })
      return
    }

    const { conversation_id, error: convErr } = await getOrCreateConversationId(user.id)
    if (convErr || !conversation_id) {
      out({ ok: false, step: "getOrCreateConversationId", convErr })
      return
    }

    // Call local AI
    const r = await fetch(LOCAL_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const ai = await r.json().catch(() => ({}))
    const reply = ai?.reply ?? ""

    // Save user message
    const { data: userRow, error: userErr2 } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        user_id: user.id,
        role: 'user',
        content: message,
      })
      .select('id, role, content')
      .single()

    if (userErr2) {
      out({ ok: false, step: "insert user message", userErr2 })
      return
    }

    // Save assistant message
    const { data: asstRow, error: asstErr } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        user_id: user.id,
        role: 'assistant',
        content: reply,
      })
      .select('id, role, content')
      .single()

    if (asstErr) {
      out({ ok: false, step: "insert assistant message", asstErr })
      return
    }

    // Load full history
    const hist = await loadHistory(conversation_id)
    if (hist.error) {
      out({ ok: false, step: "loadHistory", conversation_id, hist_error: hist.error })
      return
    }

    out({ ok: true, conversation_id, userRow, asstRow, history: hist.data })
  } catch (e) {
    out({ thrown: String(e) })
  }
}

checkSession()
