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

    const r = await fetch(LOCAL_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const data = await r.json() // expected: { reply: "..." }
    out({ data })
  } catch (e) {
    out({ thrown: String(e) })
  }
}

checkSession()
