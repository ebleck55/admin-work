"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

interface Retrieval {
  embedding_id: string;
  document_id: string;
  document_title: string;
  ledger_id: string;
  distance: number;
  sensitivity: "public" | "internal" | "private_dm";
  chunk_index: number;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  retrieval?: Retrieval[];
}

export default function AskPage() {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [personal, setPersonal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const question = input.trim();
    setInput("");
    setStreaming(true);

    const user: ChatTurn = { role: "user", content: question };
    const assistant: ChatTurn = { role: "assistant", content: "", retrieval: [] };
    setHistory((h) => [...h, user, assistant]);

    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({
          question,
          personal,
          history: history.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const events = buffered.split("\n\n");
        buffered = events.pop() ?? "";
        for (const evt of events) {
          const lines = evt.split("\n");
          let eventName = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            if (eventName === "retrieval") {
              setHistory((h) => {
                const copy = [...h];
                const idx = copy.length - 1;
                copy[idx] = { ...copy[idx], retrieval: data.hits };
                return copy;
              });
            } else if (eventName === "token") {
              setHistory((h) => {
                const copy = [...h];
                const idx = copy.length - 1;
                copy[idx] = { ...copy[idx], content: copy[idx].content + (data.delta ?? "") };
                return copy;
              });
            } else if (eventName === "error") {
              setHistory((h) => {
                const copy = [...h];
                const idx = copy.length - 1;
                copy[idx] = { ...copy[idx], content: `Error: ${data.message}` };
                return copy;
              });
            }
          } catch {
            /* ignore malformed SSE line */
          }
        }
      }
    } catch (err) {
      setHistory((h) => {
        const copy = [...h];
        const idx = copy.length - 1;
        copy[idx] = {
          ...copy[idx],
          content: copy[idx].content || `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, personal, history]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Ask</h1>
        <p className="text-slate-600">
          Q&A over the evidence ledger. Answers cite the chunks they came from.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
            disabled={streaming}
          />
          Include private DM evidence (personal mode)
        </label>
      </div>

      <div className="space-y-4">
        {history.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Try: <em>&quot;Which deals had regulatory concerns this week?&quot;</em> or{" "}
            <em>&quot;What commitments did I make to Sample Bank?&quot;</em>
          </p>
        ) : (
          history.map((turn, i) => (
            <div
              key={i}
              className={`rounded-md p-4 ${turn.role === "user" ? "bg-slate-100" : "border border-slate-200 bg-white"}`}
            >
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                {turn.role}
              </div>
              <div className="whitespace-pre-wrap text-sm text-slate-900">{turn.content}</div>
              {turn.role === "assistant" && turn.retrieval && turn.retrieval.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    {turn.retrieval.length} evidence chunks used
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {turn.retrieval.map((h, j) => (
                      <li key={h.embedding_id} className="flex items-start gap-2">
                        <span className="font-mono">#{j + 1}</span>
                        <span>
                          {h.document_title}
                          {h.sensitivity === "private_dm" ? " (private)" : ""} ·{" "}
                          <span className="font-mono">{h.distance.toFixed(3)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ))
        )}
      </div>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={streaming}
          placeholder="Ask anything grounded in the evidence ledger..."
          className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-500">⌘+Enter to send</span>
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
          >
            {streaming ? "Streaming…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}
