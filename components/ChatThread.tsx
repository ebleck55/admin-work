"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface RetrievalHit {
  embedding_id: string;
  document_title: string;
  distance: number;
  sensitivity: string;
}

interface MemoryHit {
  id: string;
  kind: string;
  text: string;
  distance: number | null;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  retrievalHits?: RetrievalHit[];
  memoryHits?: MemoryHit[];
  isStreaming?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  seedKind: string | null;
  updatedAt: string;
}

export function ChatThread({
  conversationId,
  initialMessages,
  conversations,
  conversationTitle,
}: {
  conversationId: string;
  initialMessages: Message[];
  conversations: ConversationSummary[];
  conversationTitle: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [personal, setPersonal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const message = input.trim();
    setInput("");
    setStreaming(true);

    const user: Message = { id: `tmp-u-${Date.now()}`, role: "user", content: message };
    const assistant: Message = {
      id: `tmp-a-${Date.now()}`,
      role: "assistant",
      content: "",
      isStreaming: true,
    };
    setMessages((m) => [...m, user, assistant]);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, personal }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
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
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = {
                  ...c[c.length - 1],
                  retrievalHits: data.evidenceHits,
                  memoryHits: data.memoryHits,
                };
                return c;
              });
            } else if (eventName === "token") {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = {
                  ...c[c.length - 1],
                  content: c[c.length - 1].content + (data.delta ?? ""),
                };
                return c;
              });
            } else if (eventName === "done") {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = { ...c[c.length - 1], id: data.messageId, isStreaming: false };
                return c;
              });
            } else if (eventName === "error") {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = {
                  ...c[c.length - 1],
                  content: c[c.length - 1].content || `Error: ${data.message}`,
                  isStreaming: false,
                };
                return c;
              });
            }
          } catch {
            // ignore malformed
          }
        }
      }
      router.refresh();
    } catch (err) {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = {
          ...c[c.length - 1],
          content:
            c[c.length - 1].content ||
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          isStreaming: false,
        };
        return c;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, personal, conversationId, router]);

  async function rememberThis(messageId: string, text: string) {
    const trimmed = text.slice(0, 600);
    const kind = window.prompt(
      "What kind? (preference | entity_fact | decision | context)",
      "context",
    );
    if (!kind) return;
    const finalText = window.prompt("Edit the fact to remember:", trimmed);
    if (!finalText) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        text: finalText,
        sourceMessageId: messageId.startsWith("tmp-") ? undefined : messageId,
        sourceConversationId: conversationId,
      }),
    });
  }

  return (
    <div className="flex h-screen">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 sm:block">
        <Link href="/" className="text-xs text-slate-500 hover:text-slate-700">
          ← Home
        </Link>
        <h2 className="mt-2 mb-3 text-sm font-semibold text-slate-800">Conversations</h2>
        <Link
          href="/chat"
          className="mb-3 block rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-center text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          + New
        </Link>
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className={`block rounded px-2 py-1.5 text-sm ${
                  c.id === conversationId
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-200"
                }`}
              >
                <div className="truncate">{c.title}</div>
                <div
                  className={`text-xs ${
                    c.id === conversationId ? "text-slate-300" : "text-slate-400"
                  }`}
                >
                  {new Date(c.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center justify-between">
            <h1 className="truncate text-sm font-medium text-slate-900">{conversationTitle}</h1>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={personal}
                onChange={(e) => setPersonal(e.target.checked)}
                disabled={streaming}
              />
              Include private DMs
            </label>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl py-10 text-center text-slate-500">
              <p className="text-lg">What's on your mind?</p>
              <p className="mt-2 text-sm">
                Ask about an account, a deal, a person on your team — or just describe a
                situation you're trying to figure out.
              </p>
            </div>
          ) : (
            <ul className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-md p-4 ${
                    m.role === "user"
                      ? "bg-slate-100"
                      : "border border-slate-200 bg-white"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-slate-500">
                      {m.role}
                    </span>
                    {m.role === "assistant" && !m.isStreaming && !m.id.startsWith("tmp-") ? (
                      <button
                        type="button"
                        onClick={() => rememberThis(m.id, m.content)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        ⭐ Remember this
                      </button>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                    {m.content}
                    {m.isStreaming ? (
                      <span className="ml-1 inline-block h-3 w-2 animate-pulse bg-slate-400" />
                    ) : null}
                  </div>
                  {(m.retrievalHits?.length || m.memoryHits?.length) ? (
                    <details className="mt-3 text-xs text-slate-500">
                      <summary className="cursor-pointer">
                        Context used: {m.memoryHits?.length ?? 0} memory ·{" "}
                        {m.retrievalHits?.length ?? 0} evidence chunks
                      </summary>
                      {m.memoryHits && m.memoryHits.length > 0 ? (
                        <div className="mt-2">
                          <div className="font-medium">Memory:</div>
                          <ul className="mt-1 space-y-1">
                            {m.memoryHits.map((mm) => (
                              <li key={mm.id}>
                                · [{mm.kind}] {mm.text.slice(0, 200)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {m.retrievalHits && m.retrievalHits.length > 0 ? (
                        <div className="mt-2">
                          <div className="font-medium">Evidence:</div>
                          <ul className="mt-1 space-y-1">
                            {m.retrievalHits.map((r) => (
                              <li key={r.embedding_id}>
                                · {r.document_title}
                                {r.sensitivity === "private_dm" ? " (private)" : ""} ·{" "}
                                <span className="font-mono">{r.distance.toFixed(3)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </details>
                  ) : null}
                </li>
              ))}
              <div ref={bottomRef} />
            </ul>
          )}
        </div>

        <form
          className="border-t border-slate-200 bg-white px-6 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="mx-auto max-w-3xl">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              disabled={streaming}
              placeholder="Ask anything…"
              className="w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-slate-500">⌘+Enter to send</span>
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white disabled:bg-slate-300"
              >
                {streaming ? "Streaming…" : "Send"}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
