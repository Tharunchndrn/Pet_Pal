import './style.css';
import { createClient } from '@supabase/supabase-js';

// ── Supabase init ──────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── State ──────────────────────────────────────────────────────────────────
let currentUser    = null;
let conversationId = null;
let isWaiting      = false;
let currentEmotion = 'calm';

// ── Emotion config ─────────────────────────────────────────────────────────
const EMOTIONS = {
  happy:    { color: '#fbbf24', tip: "You seem happy today. Keep building on what's going well." },
  calm:     { color: '#2dd4bf', tip: 'You seem calm. A great time for gentle reflection.' },
  sad:      { color: '#60a5fa', tip: "It sounds like a tough day. Take it one step at a time." },
  angry:    { color: '#f87171', tip: "It's okay to feel frustrated. Take a breath first." },
  anxious:  { color: '#fb923c', tip: 'Feeling anxious? Try slowing your breath for a moment.' },
  stressed: { color: '#a78bfa', tip: "You're carrying a lot. It's okay to take a small break." },
  confused: { color: '#94a3b8', tip: "Things feel unclear right now. Let's slow it down together." },
};

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(message, type = 'default') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''} show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.classList.remove('show'); }, 3200);
}

// ── Debug ──────────────────────────────────────────────────────────────────
function debugLog(data) {
  const out = document.getElementById('debugOutput');
  if (out) out.textContent = JSON.stringify(data, null, 2);
}

// ── Auth helpers ───────────────────────────────────────────────────────────
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
  currentUser    = null;
  conversationId = null;
  currentEmotion = 'calm';
  render();
  showToast('Signed out');
}

// ── Conversation helpers ───────────────────────────────────────────────────
async function getOrCreateConversationId(userId) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

async function loadHistory(convId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function saveMessage(convId, role, content, emotion = null) {
  if (!currentUser?.id) return;
  const row = {
    conversation_id: convId,
    user_id:         currentUser.id,
    role,
    content,
  };
  if (emotion) row.emotion = emotion;
  const { error } = await supabase.from('messages').insert(row);
  if (error) console.error('Save message error:', error);
}

// ── Chat API ───────────────────────────────────────────────────────────────
async function sendToAPI(message) {
  const res = await fetch('http://localhost:3001/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message }),
  });

  if (res.status === 429) throw new Error('rate_limit');
  if (!res.ok) throw new Error(`API error ${res.status}`);

  return res.json();
}

// ── Render helpers ─────────────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeBubble({ role, content, created_at, isCrisis = false }) {
  const isUser      = role === 'user';
  const side        = isUser ? 'right' : 'left';
  const label       = isUser ? 'You' : 'PetChat 🐾';
  const crisisClass = isCrisis ? ' crisis' : '';

  return `
    <div class="bubble ${side}${crisisClass}">
      <span class="bubble-meta">${label}</span>
      <div class="bubble-body">${escapeHtml(content)}</div>
      <span class="bubble-time">${formatTime(created_at)}</span>
    </div>
  `;
}

function makeTypingIndicator() {
  return `
    <div class="bubble left" id="typingBubble">
      <span class="bubble-meta">PetChat 🐾</span>
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  `;
}

// ── Emotion badge update ───────────────────────────────────────────────────
function updateEmotion(emotion) {
  const e   = (emotion && EMOTIONS[emotion]) ? emotion : 'calm';
  currentEmotion = e;
  const cfg = EMOTIONS[e];

  const badge = document.getElementById('emotionBadge');
  const tip   = document.getElementById('emotionTip');

  if (badge) {
    badge.textContent       = e.charAt(0).toUpperCase() + e.slice(1);
    badge.style.background  = cfg.color + '22';
    badge.style.color       = cfg.color;
    badge.style.borderColor = cfg.color + '44';
  }
  if (tip) tip.textContent = cfg.tip;
}

// ── Scroll to bottom ───────────────────────────────────────────────────────
function scrollBottom() {
  const box = document.getElementById('chatBox');
  if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

// ── Password strength ──────────────────────────────────────────────────────
function getPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak',   level: 1 };
  if (score <= 2) return { label: 'Medium', level: 2 };
  return { label: 'Strong', level: 3 };
}

// ── Render auth page ───────────────────────────────────────────────────────
function renderAuth() {
  document.getElementById('app').innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-card">

        <div class="auth-lottie">
          <lottie-player
            src="https://lottie.host/069be47b-a4d1-44f5-a5d3-5c737a2dd15e/RqDJqrKMtx.json"
            background="transparent"
            speed="1"
            style="width:180px;height:180px;"
            loop autoplay>
          </lottie-player>
        </div>

        <h1 class="auth-title">PetChat</h1>
        <p class="auth-tagline">Your gentle wellbeing companion</p>

        <div class="tab-switcher">
          <button class="tab-btn active" data-tab="signin">Sign In</button>
          <button class="tab-btn" data-tab="signup">Create Account</button>
        </div>

        <!-- Sign In -->
        <div class="tab-panel active" id="panel-signin">
          <div class="field">
            <label class="field-label">Email</label>
            <input class="input" type="email" id="signinEmail" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="field">
            <label class="field-label">Password</label>
            <div class="pw-wrap">
              <input class="input" type="password" id="signinPw" placeholder="••••••••" autocomplete="current-password" />
              <button class="pw-toggle" id="signinToggle" type="button" aria-label="Show password">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>
          <button class="btn primary full" id="signinBtn">Sign In</button>
          <div class="auth-message" id="signinMsg"></div>
        </div>

        <!-- Sign Up -->
        <div class="tab-panel" id="panel-signup">
          <div class="field">
            <label class="field-label">Email</label>
            <input class="input" type="email" id="signupEmail" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="field">
            <label class="field-label">Password</label>
            <div class="pw-wrap">
              <input class="input" type="password" id="signupPw" placeholder="••••••••" autocomplete="new-password" />
              <button class="pw-toggle" id="signupToggle" type="button" aria-label="Show password">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <div class="strength-bar-wrap" id="strengthWrap">
              <div class="strength-bar" id="strengthBar"></div>
            </div>
            <span class="strength-label" id="strengthLabel"></span>
          </div>
          <div class="field">
            <label class="field-label">Confirm Password</label>
            <input class="input" type="password" id="signupConfirm" placeholder="••••••••" autocomplete="new-password" />
          </div>
          <button class="btn primary full" id="signupBtn">Create Account</button>
          <p class="terms-note">By signing up you agree to use this service responsibly.</p>
          <div class="auth-message" id="signupMsg"></div>
        </div>

        <div class="auth-status-bar">
          <span class="status-dot" id="statusDot"></span>
          <span id="authStatus">Connecting to PetChat...</span>
        </div>

      </div>
    </div>
    <div class="toast" id="toast"></div>
  `;

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Password toggles
  function setupToggle(toggleId, inputId) {
    document.getElementById(toggleId)?.addEventListener('click', () => {
      const inp = document.getElementById(inputId);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }
  setupToggle('signinToggle', 'signinPw');
  setupToggle('signupToggle', 'signupPw');

  // Password strength
  document.getElementById('signupPw')?.addEventListener('input', e => {
    const val = e.target.value;
    const { label, level } = getPasswordStrength(val);
    const bar = document.getElementById('strengthBar');
    const lbl = document.getElementById('strengthLabel');
    if (bar) { bar.className = `strength-bar level-${level}`; bar.style.width = `${(level / 3) * 100}%`; }
    if (lbl) { lbl.textContent = val ? label : ''; lbl.className = `strength-label level-${level}`; }
  });

  // Sign in
  document.getElementById('signinPw')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSignIn(); });
  document.getElementById('signinBtn')?.addEventListener('click', doSignIn);

  async function doSignIn() {
    const email = document.getElementById('signinEmail')?.value.trim();
    const pw    = document.getElementById('signinPw')?.value;
    const msg   = document.getElementById('signinMsg');
    if (!email || !pw) { setMsg(msg, 'Please fill in all fields.', 'error'); return; }
    try {
      setMsg(msg, 'Signing in…', '');
      document.getElementById('signinBtn').disabled = true;
      await signIn(email, pw);
    } catch (err) {
      setMsg(msg, err.message, 'error');
      document.getElementById('signinBtn').disabled = false;
    }
  }

  // Sign up
  document.getElementById('signupBtn')?.addEventListener('click', async () => {
    const email   = document.getElementById('signupEmail')?.value.trim();
    const pw      = document.getElementById('signupPw')?.value;
    const confirm = document.getElementById('signupConfirm')?.value;
    const msg     = document.getElementById('signupMsg');
    if (!email || !pw || !confirm) { setMsg(msg, 'Please fill in all fields.', 'error'); return; }
    if (pw !== confirm) { setMsg(msg, 'Passwords do not match.', 'error'); return; }
    if (pw.length < 6)  { setMsg(msg, 'Password must be at least 6 characters.', 'error'); return; }
    try {
      setMsg(msg, 'Creating account…', '');
      document.getElementById('signupBtn').disabled = true;
      await signUp(email, pw);
      setMsg(msg, 'Account created! Check your email to confirm.', 'success');
      showToast('Account created! Check your email.', 'success');
      document.getElementById('signupBtn').disabled = false;
    } catch (err) {
      setMsg(msg, err.message, 'error');
      document.getElementById('signupBtn').disabled = false;
    }
  });

  // Status dot
  setTimeout(() => {
    const dot    = document.getElementById('statusDot');
    const status = document.getElementById('authStatus');
    if (dot) dot.classList.add('active');
    if (status) status.textContent = 'Ready';
  }, 1200);
}

function setMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className   = `auth-message ${type}`;
}

// ── Render chat page ───────────────────────────────────────────────────────
function renderChat(messages = []) {
  const email = currentUser?.email || '';
  const cfg   = EMOTIONS[currentEmotion] || EMOTIONS.calm;

  const bubblesHtml = messages.length === 0
    ? `<div class="empty-state">
         <div class="empty-icon">🐾</div>
         <p>Say hello — I'm here to listen.</p>
       </div>`
    : messages.map(m => makeBubble(m)).join('');

  document.getElementById('app').innerHTML = `
    <div class="chat-shell">

      <header class="chat-header">
        <div class="brand">
          <div class="brand-icon">🐾</div>
          <div>
            <div class="brand-name">PetChat</div>
            <div class="brand-tagline">Your gentle companion</div>
          </div>
        </div>
        <div class="header-actions">
          <span class="user-pill">${escapeHtml(email)}</span>
          <button class="btn ghost" id="signOutBtn">Sign Out</button>
        </div>
      </header>

      <div class="chat-body">

        <aside class="sidebar">
          <p class="card-title">Your Session</p>
          <div class="emotion-section">
            <span class="emotion-badge" id="emotionBadge"
              style="background:${cfg.color}22;color:${cfg.color};border-color:${cfg.color}44;">
              ${currentEmotion.charAt(0).toUpperCase() + currentEmotion.slice(1)}
            </span>
            <p class="emotion-tip" id="emotionTip">${cfg.tip}</p>
          </div>
          <hr class="divider" />
          <div class="crisis-section">
            <p class="crisis-title">Need help now?</p>
            <div class="crisis-line">
              <span class="crisis-label">Sumithrayo Sri Lanka</span>
              <a href="tel:+94112692909" class="crisis-number">+94 11 269 2909</a>
            </div>
            <div class="crisis-line">
              <span class="crisis-label">CCCline</span>
              <a href="tel:1333" class="crisis-number">1333</a>
            </div>
            <div class="crisis-line">
              <span class="crisis-label">Emergency</span>
              <a href="tel:119" class="crisis-number">119</a>
            </div>
          </div>
        </aside>

        <div class="chat-area">
          <div class="chat-box" id="chatBox">${bubblesHtml}</div>
          <div class="chat-input-area">
            <div class="chat-input-wrap">
              <textarea
                class="chat-input"
                id="chatInput"
                placeholder="Say something… I'm here 🐾"
                rows="1"
              ></textarea>
            </div>
            <button class="send-btn" id="sendBtn" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>

      </div>

      <div class="debug-section">
        <div class="debug-toggle" id="debugToggle">
          <span class="debug-arrow" id="debugArrow">▶</span>
          Debug output
        </div>
        <pre class="output" id="debugOutput"></pre>
      </div>

    </div>
    <div class="toast" id="toast"></div>
  `;

  document.getElementById('signOutBtn')?.addEventListener('click', signOut);

  document.getElementById('debugToggle')?.addEventListener('click', () => {
    document.getElementById('debugOutput')?.classList.toggle('visible');
    document.getElementById('debugArrow')?.classList.toggle('open');
  });

  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    if (sendBtn) sendBtn.disabled = input.value.trim() === '' || isWaiting;
  });

  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn?.disabled) handleSend(); }
  });

  sendBtn?.addEventListener('click', handleSend);

  scrollBottom();
}

// ── Handle send ────────────────────────────────────────────────────────────
async function handleSend() {
  const input   = document.getElementById('chatInput');
  const message = input?.value.trim();
  if (!message || isWaiting) return;

  isWaiting = true;
  if (input) { input.value = ''; input.style.height = 'auto'; input.disabled = true; }
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  const chatBox = document.getElementById('chatBox');
  const empty   = chatBox?.querySelector('.empty-state');
  if (empty) empty.remove();

  // Optimistic user bubble
  const userWrap = document.createElement('div');
  userWrap.innerHTML = makeBubble({ role: 'user', content: message, created_at: new Date().toISOString() });
  chatBox?.appendChild(userWrap.firstElementChild);
  scrollBottom();

  // Typing indicator
  const typingWrap = document.createElement('div');
  typingWrap.innerHTML = makeTypingIndicator();
  const typingEl = typingWrap.firstElementChild;
  chatBox?.appendChild(typingEl);
  scrollBottom();

  // Save user message
  if (conversationId) await saveMessage(conversationId, 'user', message);

  try {
    const data = await sendToAPI(message);
    debugLog(data);

    typingEl.remove();

    const reply    = (data.reply || data.message || '…').trim().replace(/\n{3,}/g, '\n\n');
    const emotion  = data.emotion  || 'calm';
    const isCrisis = !!data.crisis;

    if (conversationId) await saveMessage(conversationId, 'assistant', reply, emotion);

    const asstWrap = document.createElement('div');
    asstWrap.innerHTML = makeBubble({ role: 'assistant', content: reply, created_at: new Date().toISOString(), isCrisis });
    chatBox?.appendChild(asstWrap.firstElementChild);

    updateEmotion(emotion);
    scrollBottom();

  } catch (err) {
    typingEl?.remove();
    debugLog({ error: err.message });

    const errMsg = err.message === 'rate_limit'
      ? "You're sending messages too quickly. Please wait a moment. 🐾"
      : 'Something went wrong. Please try again.';

    const errWrap = document.createElement('div');
    errWrap.innerHTML = makeBubble({ role: 'assistant', content: errMsg, created_at: new Date().toISOString() });
    chatBox?.appendChild(errWrap.firstElementChild);
    scrollBottom();

    showToast(err.message === 'rate_limit' ? 'Slow down a little 🐾' : 'Connection error', 'error');
  }

  isWaiting = false;
  if (input) { input.disabled = false; input.focus(); }
  const btn = document.getElementById('sendBtn');
  if (btn) btn.disabled = false;
}

// ── Main render ────────────────────────────────────────────────────────────
async function render() {
  if (!currentUser) {
    renderAuth();
    return;
  }

  try {
    conversationId = await getOrCreateConversationId(currentUser.id);
    const messages = await loadHistory(conversationId);
    renderChat(messages);

    const lastWithEmotion = [...messages].reverse().find(m => m.role === 'assistant' && m.emotion);
    if (lastWithEmotion?.emotion) updateEmotion(lastWithEmotion.emotion);

  } catch (err) {
    console.error('Load error:', err);
    renderChat([]);
  }
}

// ── Auth listener ──────────────────────────────────────────────────────────
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    await render();
    if (event === 'SIGNED_IN') showToast('Welcome back 🐾', 'success');
  } else {
    currentUser = null;
    conversationId = null;
    render();
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) currentUser = session.user;
  await render();
})();
