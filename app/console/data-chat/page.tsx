"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { DataChatResponse } from "@/lib/dataChat/schemas";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { MessageBubble } from "./_components/MessageBubble";
import type { DataChatTurn } from "./_components/types";

// DATA CHAT console — a conversational, tool-using Claude agent scoped to YOUR
// organization's own evidence library. The user chats; Claude decides which org-
// scoped tools to call (saved reports, cached sources, filed claims), and every
// answer is shown WITH its tool trace and its grounded citation trail into your own
// data. No fact about a report/source/claim appears without a chip pointing at it.
//
// Sends x-org-id from localStorage (pt_active_org) so the server resolves the active
// org — the server still verifies membership; the header is only a hint.

const EXAMPLES = [
  "What have we concluded across our saved evidence reports?",
  "How many of our reports rate the evidence as high certainty?",
  "Which of our tracked claims are flagged?",
];

let turnSeq = 0;
function nextId(): string {
  turnSeq += 1;
  return `turn-${turnSeq}-${Date.now()}`;
}

export default function DataChatPage() {
  const [turns, setTurns] = useState<DataChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || loading) return;

      setError(null);
      const userTurn: DataChatTurn = { id: nextId(), role: "user", content: trimmed };

      // Snapshot the conversation (including this new user turn) as the wire payload.
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setInput("");
      setLoading(true);

      const payloadMessages = nextTurns.map((t) => ({ role: t.role, content: t.content }));

      try {
        const orgId =
          typeof window !== "undefined" ? window.localStorage.getItem("pt_active_org") : null;
        const res = await fetch("/api/data-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(orgId ? { "x-org-id": orgId } : {}),
          },
          body: JSON.stringify({ messages: payloadMessages }),
        });
        const body = (await res.json().catch(() => null)) as ApiResponse<DataChatResponse> | null;
        if (!body) {
          throw new Error("Unexpected server response.");
        }
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? "The data-chat request failed.");
        }
        const data = body.data;
        setTurns((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: data.answer,
            toolTrace: data.toolTrace,
            citations: data.citations,
            iterations: data.iterations,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reach Data Chat.");
      } finally {
        setLoading(false);
      }
    },
    [turns, loading]
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void send(input);
    },
    [input, send]
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <ModuleHeader
        title="Data Chat"
        subtitle="Ask questions about your organization's own evidence library. Claude queries your saved reports, sources, and claims — every answer shows its tool trace and links back to your own data."
      />

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink/15 bg-paper">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="max-w-md text-sm text-ink/40">
                Ask about what your organization has saved and tracked. Data Chat only cites
                items its tools return from your own library — if it can&apos;t ground an
                answer in your data, it will say so.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void send(ex)}
                    className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink/70 hover:border-accent hover:text-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t) => <MessageBubble key={t.id} turn={t} />)
          )}

          {loading ? (
            <div className="flex justify-start">
              <div className="rounded-lg rounded-bl-sm border border-ink/15 bg-white px-3 py-2 text-sm text-ink/40">
                Querying your library…
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="border-t border-ink/10 px-4 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="border-t border-ink/15 p-3">
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about your saved reports, sources, or claims…"
              aria-label="Ask about your saved reports, sources, or claims"
              className="flex-1 resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
