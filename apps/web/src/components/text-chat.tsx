"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { executeTool } from "@/lib/tool-executor";
import "./text-chat.css";

type Item = Record<string, unknown>;
type Message = { role: "user" | "assistant"; text: string };

export function TextChat() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useRef<Item[]>([]);
  const locked = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy, open]);

  async function send() {
    const text = draft.trim();
    if (!text || locked.current) return;
    locked.current = true;
    setBusy(true); setError(""); setDraft("");
    setMessages(old => [...old, { role: "user", text }]);
    history.current.push({ role: "user", content: text });
    const checkpoint = history.current.length - 1;
    try {
      for (let step = 0; step < 12; step++) {
        const response = await fetch(`${api.base}/api/chat`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: history.current }),
          signal: AbortSignal.timeout(100_000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Send پیام ناموفق بود.");
        const message: Item = data.message;
        history.current.push(message);
        if (typeof message.content === "string" && message.content) {
          setMessages(old => [...old, { role: "assistant", text: message.content as string }]);
        }
        const calls = (message.tool_calls || []) as { id: string; function: { name: string; arguments: string } }[];
        if (!calls.length) {
          if (!message.content) throw new Error("پاسخ خالی دریافت شد؛ دوباره تلاش کنید.");
          return;
        }
        for (const call of calls) {
          let result: unknown;
          try {
            result = await executeTool(call.function.name, JSON.parse(call.function.arguments));
          } catch (cause) {
            result = { error: cause instanceof Error ? cause.message : "اجرای فرمان ناموفق بود" };
          }
          history.current.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result ?? { completed: true }) });
        }
      }
      throw new Error("تعداد مراحل این درخواست زیاد شد؛ ادامه را در پیام بعدی بنویسید.");
    } catch (cause) {
      history.current = history.current.slice(0, checkpoint);
      setDraft(text);
      setError(cause instanceof Error ? cause.message : "ارتباط قطع شد.");
    } finally { locked.current = false; setBusy(false); }
  }

  return <div className="text-chat" dir="ltr">
    <button className="text-chat-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="rooh-text-chat">{open ? "Hide chat" : "Chat with RooH · Groq"}</button>
    {open && <section id="rooh-text-chat" className={`text-chat-panel${expanded ? " text-chat-panel--expanded" : ""}`} aria-label="Text chat with Groq">
      <header><strong>RooH · Groq</strong><button type="button" aria-label={expanded ? "Restore chat size" : "Expand chat"} onClick={() => setExpanded(!expanded)}>{expanded ? "Restore" : "Expand"}</button><button disabled={busy} onClick={() => { history.current = []; setMessages([]); setError(""); }}>New chat</button></header>
      <div className="text-chat-messages" role="log" aria-live="polite">
        {!messages.length && <p>Ask a question or open several tools, such as music and knowledge.</p>}
        {messages.map((message, index) => <p key={index} className={`chat-${message.role}`} dir="auto"><small>{message.role === "user" ? "You" : "RooH"}</small>{message.text}</p>)}
        {busy && <p role="status">Working on your request…</p>}
        <div ref={bottom} />
      </div>
      {error && <p className="text-chat-error" role="alert">{error}</p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea aria-label="Message or command" placeholder="Message or command…" value={draft} maxLength={12000} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button disabled={busy || !draft.trim()} type="submit">Send</button>
      </form>
    </section>}
  </div>;
}
