import './style.css'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const LOCAL_AI_URL = 'http://localhost:3001/chat'

document.querySelector('#app').innerHTML = `
  <div class="container">
    <div class="header">
      <div>
        <h2 class="title">PetChat</h2>
        <div class="muted">Local AI: <code>${LOCAL_AI_URL}</code></div>
      </div>
      <div class="headerRight">
        <button class="btn" id="session">Session</button>
        <button class="btn" id="signout">Sign out</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Auth</h3>
        <input class="input" id="email" placeholder="Email" />
        <input class="input" id="password" type="password" placeholder="Password" />
        <div class="row">
          <button class="btn" id="signup">Sign up</button>
          <button class="btn primary" id="signin">Sign in</button>
        </div>
        <div class="muted" id="authStatus"></div>
      </div>

      <div class="card chatCard">
        <div class="chatTop">
          <h3>Chat</h3>
          <button class="btn" id="reload">Reload</button>
        </div>

        <div class="chatBox" id="chatBox"></div>

        <form class="chatForm" id="chatForm">
          <input class="input" id="msg" placeholder="Type a message…" autocomplete="off" />
          <button class="btn primary" id="send" type="submit">Send</button>
        </form>
      </div>
    </div>

    <div class="outputTitle">Debug Output</div>
    <pre class="output" id="out"></pre>
  </div>
`

// Small UI helpers
const outEl = document.querySelector('#out')
const out = (obj) => { outEl.textContent = JSON.stringify(obj, null, 2) }
const chatBox = document.querySelector('#chatBox')
const authStatus = document.querySelector('#authStatus')

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderMessages(rows) {
  chatBox.innerHTML = rows.map(m => {
    const side = m.role === 'user' ? 'right' : 'left'
    return `
      <div class="bubble ${side}">
        <div class="role">${escapeHtml(m.role)}</div>
        <div class="content">${escapeHtml(m.content)}</div>
      </div>
    `
  }).join('')

  chatBox.scrollTop = chatBox.scrollHeight
}

async function getUserOrThrow() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw error ?? new Error('Not signed in')
  return user
}

async function getOrCreateConversationId(userId) {
  const { data: conv, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (selErr) throw selErr
  if (conv?.id) return conv.id

  const { data: newConv, error: insErr } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title: 'My Chat' })
    .select('id')
    .single()

  if (insErr) throw insErr
  return newConv.id
}

async function loadHistory(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

async function refreshAuthUI() {
  const { data } = await supabase.auth.getSession()
  if (data?.session?.user?.email) {
    authStatus.textContent = `Signed in as ${data.session.user.email}`
  } else {
    authStatus.textContent = `Not signed in`
  }
}

async function refreshChat() {
  try {
    const user = await getUserOrThrow()
    const conversationId = await getOrCreateConversationId(user.id)
    const rows = await loadHistory(conversationId)
    renderMessages(rows)
    out({ ok: true, conversation_id: conversationId, messages: rows.length })
  } catch (e) {
    renderMessages([])
    out({ ok: false, error: String(e) })
  }
}

// Auth actions
document.querySelector('#signup').onclick = async () => {
  const email = document.querySelector('#email').value
  const password = document.querySelector('#password').value
  const { data, error } = await supabase.auth.signUp({ email, password })
  out({ data, error })
  await refreshAuthUI()
}

document.querySelector('#signin').onclick = async () => {
  const email = document.querySelector('#email').value
  const password = document.querySelector('#password').value
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  out({ data, error })
  await refreshAuthUI()
  await refreshChat()
}

document.querySelector('#signout').onclick = async () => {
  const { error } = await supabase.auth.signOut()
  out({ ok: true, error })
  await refreshAuthUI()
  renderMessages([])
}

document.querySelector('#session').onclick = async () => {
  const { data, error } = await supabase.auth.getSession()
  out({ session: data?.session ? { user: data.session.user.email } : null, error })
}

document.querySelector('#reload').onclick = refreshChat

// Send message (local AI + save to DB + reload)
// Send message (local AI + save to DB + reload)
document.querySelector('#chatForm').onsubmit = async (ev) => {
  ev.preventDefault()
  const input = document.querySelector('#msg')
  const message = input.value.trim()
  if (!message) return

  try {
    const user = await getUserOrThrow()
    const conversationId = await getOrCreateConversationId(user.id)

    // Optimistic UI: show user message immediately
    const current = await loadHistory(conversationId)
    renderMessages([...current, { role: 'user', content: message }])

    // Local Ollama call
    const r = await fetch(LOCAL_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    if (r.status === 429) {
      const data = await r.json()
      out({ ok: false, error: data.error || "Too many messages. Please wait a moment." })
      // Small toast / banner in chatBox (optional)
      const toast = document.createElement('div')
      toast.className = 'bubble left toast-error'
      toast.innerHTML = `<div class="role">system</div><div class="content">${escapeHtml(data.error || "Too many messages. Please wait.")}</div>`
      chatBox.appendChild(toast)
      chatBox.scrollTop = chatBox.scrollHeight
      return
    }

    const ai = await r.json().catch(() => ({}))
    const reply = (ai?.reply ?? '').trim()

    // Save both rows
    const { error: insErr } = await supabase.from('messages').insert([
      { conversation_id: conversationId, user_id: user.id, role: 'user', content: message },
      { conversation_id: conversationId, user_id: user.id, role: 'assistant', content: reply || '(no reply)' },
    ])
    if (insErr) throw insErr

    input.value = ''
    await refreshChat()
  } catch (e) {
    out({ ok: false, error: String(e) })
  }
}


// Initial load
await refreshAuthUI()
await refreshChat()
