import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

const DEMO_CHATS = [
  { id: "c1", title: "New chat", messages: [] },
  {
    id: "c2",
    title: "UI/UX ideas",
    messages: [
      { id: "m1", role: "assistant", text: "Tell me what you want to build, and I’ll help you design it." },
    ],
  },
];

function uid() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random());
}

export default function App() {
  const [chats, setChats] = useState(DEMO_CHATS);
  const [activeId, setActiveId] = useState(DEMO_CHATS[0].id);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeId) || chats[0],
    [chats, activeId]
  );

  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages?.length]);

  function newChat() {
    const id = uid();
    const next = { id, title: "New chat", messages: [] };
    setChats((prev) => [next, ...prev]);
    setActiveId(id);
    setInput("");
  }

  function send() {
    const text = input.trim();
    if (!text) return;

    const userMsg = { id: uid(), role: "user", text };

    // Demo assistant reply (replace later with your backend call)
    const assistantMsg = {
      id: uid(),
      role: "assistant",
      text:
        "✅ Got it. This is a demo reply for now.\n\nIf you connect your backend, I can answer with real responses.",
    };

    setChats((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 28) : c.title,
              messages: [...c.messages, userMsg, assistantMsg],
            }
          : c
      )
    );

    setInput("");
  }

  function onKeyDown(e) {
    // Enter = send, Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="cg-root">
      {/* Sidebar */}
      <aside className={`cg-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="cg-sideTop">
          <button className="cg-iconBtn" onClick={() => setSidebarOpen((s) => !s)} title="Toggle sidebar">
            ☰
          </button>

          <button className="cg-newChat" onClick={newChat}>
            + New chat
          </button>
        </div>

        <div className="cg-sideSectionTitle">Chats</div>

        <div className="cg-chatList">
          {chats.map((c) => (
            <button
              key={c.id}
              className={`cg-chatItem ${c.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(c.id)}
              title={c.title}
            >
              <span className="cg-chatDot" />
              <span className="cg-chatTitle">{c.title}</span>
            </button>
          ))}
        </div>

        <div className="cg-sideBottom">
          <div className="cg-userCard">
            <div className="cg-avatar">S</div>
            <div className="cg-userMeta">
              <div className="cg-userName">Shaveen</div>
              <div className="cg-userSub">UI/UX • Pet_Pal</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="cg-main">
        <header className="cg-topbar">
          <button className="cg-iconBtn mobileOnly" onClick={() => setSidebarOpen(true)} title="Open sidebar">
            ☰
          </button>
          <div className="cg-title">{activeChat?.title || "Chat"}</div>
          <div className="cg-topActions">
            <button className="cg-iconBtn" onClick={newChat} title="New chat">
              ＋
            </button>
          </div>
        </header>

        <section className="cg-thread">
          {activeChat.messages.length === 0 ? (
            <div className="cg-empty">
              <h1>What can I help with?</h1>
              <p>Try asking: “Make this UI look like ChatGPT” or “Add disclaimer screen”.</p>
            </div>
          ) : (
            activeChat.messages.map((m) => (
              <div key={m.id} className={`cg-row ${m.role}`}>
                <div className="cg-bubble">
                  <div className="cg-bubbleRole">{m.role === "user" ? "You" : "Assistant"}</div>
                  <div className="cg-bubbleText">{m.text}</div>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </section>

        <footer className="cg-composerWrap">
          <div className="cg-composer">
            <textarea
              className="cg-input"
              placeholder="Message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
            />
            <button className="cg-send" onClick={send} disabled={!input.trim()}>
              Send
            </button>
          </div>

          <div className="cg-hint">
            Enter to send • Shift+Enter for new line
          </div>
        </footer>
      </main>
    </div>
  );
}