import './style.css'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const LOCAL_AI_URL = 'http://localhost:3001/chat'

// ── Render app shell ──────────────────────────────────────────────────────────
document.querySelector('#app').innerHTML = `
  <div class="app-shell">

    <!-- Header -->
    <header class="header">
      <div class="brand">
        <div class="brand-icon">🐾</div>
        <div>
          <div class="brand-name">PetChat</div>
          <div class="brand-tagline">Your gentle companion</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn ghost" id="session" title="Check session">Session</button>
        <button class="btn danger ghost" id="signout" title="Sign out">Sign out</button>
      </div>
    </header>

    <!-- Main grid -->
    <div class="grid">

      <!-- Auth card -->
      <div class="card">
        <div class="card-title">Welcome back</div>

        <div class="field">
          <label class="field-label" for="email">Email</label>
          <input class="input" id="email" type="email" placeholder="you@example.com" autocomplete="email" />
        </div>

        <div class="field">
          <label class="field-label" for="password">Password</label>
          <input class="input" id="password" type="password" placeholder="••••••••" autocomplete="current-password" />
        </div>

        <div class="row">
          <button class="btn" id="signup">Create account</button>
          <button class="btn primary" id="signin">Sign in</button>
        </div>

        <div class="auth-status-bar">
          <div class="status-dot" id="statusDot"></div>
          <span id="authStatus">Not signed in</span>
        </div>
      </div>

      <!-- Chat card -->
      <div class="card chat-card">
        <div class="chat-header">
          <div class="card-title" style="margin-bottom:0">Chat</div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="chat-status">
              <div class="pulse"></div>
              <span>Local AI</span>
            </div>
            <button class="btn ghost" id="reload" title="Reload messages">↺ Reload</button>
          </div>
        </div>

        <div class="chat-box" id="chatBox">
          <div class="empty-state" id="emptyState">
            <div class="empty-icon">🐾</div>
            <p>Sign in and say hello — I'm here to listen.</p>
          </div>
        </div>

        <form class="chat-input-area" id="chatForm">
          <div class="chat-input-wrap">
            <textarea
              class="chat-input"
              id="msg"
              placeholder="How are you feeling today…"
              rows="1"
              autocomplete="off"
            ></textarea>
          </div>
          <button class="send-btn" id="send" type="submit" disabled title="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>
    </div>

    <!-- Debug -->
    <div class="debug-section">
      <div class="debug-toggle" id="debugToggle">
        <span class="debug-arrow" id="debugArrow">▶</span>
        Debug output
      </div>
      <pre class="output" id="out"></pre>
    </div>

  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>
`

// ── DOM refs ──────────────────────────────────────────────────────────────────
const outEl       = document.querySelector('#out')
const chatBox     = document.querySelector('#chatBox')
const authStatus  = document.querySelector('#authStatus')
const statusDot   = document.querySelector('#statusDot')
const emptyState  = document.querySelector('#emptyState')
const sendBtn     = document.querySelector('#send')
const msgInput    = document.querySelector('#msg')
const toastEl     = document.querySelector('#toast')

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function out(obj) {
  outEl.textContent = JSON.stringify(obj, null, 2)
}

let toastTimer = null
function showToast(msg, type = '') {
  toastEl.textContent = msg
  toastEl.className = `toast ${type} show`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.className = 'toast' }, 3200)
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Auto-resize textarea
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto'
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px'
  sendBtn.disabled = !msgInput.value.trim()
})

// Send on Enter (Shift+Enter for newline)
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (!sendBtn.disabled) {
      document.querySelector('#chatForm').requestSubmit()
    }
  }
})

// Debug toggle
document.querySelector('#debugToggle').addEventListener('click', () => {
  outEl.classList.toggle('visible')
  document.querySelector('#debugArrow').classList.toggle('open')
})

// ── Render ────────────────────────────────────────────────────────────────────
function renderMessages(rows) {
  if (!rows.length) {
    chatBox.innerHTML = ''
    chatBox.appendChild(emptyState)
    emptyState.style.display = 'flex'
    return
  }

  emptyState.style.display = 'none'

  chatBox.innerHTML = rows.map(m => {
    const side = m.role === 'user' ? 'right' : 'left'
    const label = m.role === 'user' ? 'You' : 'PetChat'
    const time = m.created_at ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">${formatTime(m.created_at)}</span>` : ''
    return `
      <div class="bubble ${side}">
        <div class="bubble-meta">${escapeHtml(label)}${time}</div>
        <div class="bubble-body">${escapeHtml(m.content)}</div>
      </div>
    `
  }).join('')

  chatBox.scrollTop = chatBox.scrollHeight
}

function addSystemBubble(text, isError = false) {
  const div = document.createElement('div')
  div.className = `bubble left${isError ? ' system' : ''}`
  div.innerHTML = `
    <div class="bubble-meta">System</div>
    <div class="bubble-body">${escapeHtml(text)}</div>
  `
  chatBox.appendChild(div)
  chatBox.scrollTop = chatBox.scrollHeight
}

function showTyping() {
  const el = document.createElement('div')
  el.className = 'bubble left'
  el.id = 'typingBubble'
  el.innerHTML = `
    <div class="bubble-meta">PetChat</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `
  chatBox.appendChild(el)
  chatBox.scrollTop = chatBox.scrollHeight
}

function hideTyping() {
  document.querySelector('#typingBubble')?.remove()
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function getUserOrThrow() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw error ?? new Error('Not signed in')
  return user
}

async function refreshAuthUI() {
  const { data } = await supabase.auth.getSession()
  const email = data?.session?.user?.email
  if (email) {
    authStatus.textContent = `Signed in as ${email}`
    statusDot.classList.add('active')
    sendBtn.disabled = !msgInput.value.trim()
  } else {
    authStatus.textContent = 'Not signed in'
    statusDot.classList.remove('active')
    sendBtn.disabled = true
  }
}

// ── Conversation helpers ──────────────────────────────────────────────────────
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

// ── Auth actions ──────────────────────────────────────────────────────────────
document.querySelector('#signup').onclick = async () => {
  const email = document.querySelector('#email').value.trim()
  const password = document.querySelector('#password').value
  if (!email || !password) { showToast('Please enter email and password', 'error'); return }

  const { data, error } = await supabase.auth.signUp({ email, password })
  out({ data, error })

  if (error) {
    showToast(error.message, 'error')
  } else {
    showToast('Account created! Check your email to confirm.')
  }

  await refreshAuthUI()
}

document.querySelector('#signin').onclick = async () => {
  const email = document.querySelector('#email').value.trim()
  const password = document.querySelector('#password').value
  if (!email || !password) { showToast('Please enter email and password', 'error'); return }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  out({ data, error })

  if (error) {
    showToast(error.message, 'error')
  } else {
    showToast('Welcome back 🐾')
    await refreshAuthUI()
    await refreshChat()
  }
}

document.querySelector('#signout').onclick = async () => {
  const { error } = await supabase.auth.signOut()
  out({ ok: true, error })
  await refreshAuthUI()
  renderMessages([])
  showToast('Signed out')
}

document.querySelector('#session').onclick = async () => {
  const { data, error } = await supabase.auth.getSession()
  out({ session: data?.session ? { user: data.session.user.email } : null, error })
}

document.querySelector('#reload').onclick = async () => {
  await refreshChat()
  showToast('Messages refreshed')
}

// ── Send message ──────────────────────────────────────────────────────────────
document.querySelector('#chatForm').onsubmit = async (ev) => {
  ev.preventDefault()
  const message = msgInput.value.trim()
  if (!message) return

  // Lock input while sending
  msgInput.value = ''
  msgInput.style.height = 'auto'
  msgInput.disabled = true
  sendBtn.disabled = true

  try {
    const user = await getUserOrThrow()
    const conversationId = await getOrCreateConversationId(user.id)

    // Optimistic: show user bubble immediately
    const current = await loadHistory(conversationId)
    renderMessages([...current, { role: 'user', content: message }])

    // Show typing indicator
    showTyping()

    const r = await fetch(LOCAL_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    hideTyping()

    if (r.status === 429) {
      const data = await r.json().catch(() => ({}))
      const errMsg = data.error || 'Too many messages. Please wait a moment.'
      out({ ok: false, error: errMsg })
      addSystemBubble(errMsg, true)
      showToast(errMsg, 'error')
      return
    }

    const ai = await r.json().catch(() => ({}))
    const reply = (ai?.reply ?? '').trim()

    // Save both rows
    const { error: insErr } = await supabase.from('messages').insert([
      { conversation_id: conversationId, user_id: user.id, role: 'user',      content: message },
      { conversation_id: conversationId, user_id: user.id, role: 'assistant', content: reply || '(no reply)' },
    ])
    if (insErr) throw insErr

    out({ ok: true, rag: ai?.rag })
    await refreshChat()

  } catch (e) {
    hideTyping()
    out({ ok: false, error: String(e) })
    addSystemBubble('Something went wrong. Please try again.', true)
    showToast('Error sending message', 'error')
  } finally {
    msgInput.disabled = false
    msgInput.focus()
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
await refreshAuthUI()
await refreshChat()