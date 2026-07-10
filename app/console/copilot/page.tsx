"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { CopilotResponse } from "@/lib/copilot/schemas";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { MessageBubble } from "./_components/MessageBubble";
import type { ChatTurn } from "./_components/types";

// RESEARCH COPILOT console — a conversational, tool-using Claude agent that drives
// PaperTrail's verification + synthesis engines. The user chats; Claude decides
// which engines to call, and every answer is shown WITH its tool trace and its
// grounded citation trail. No claim about a source appears without a source chip.

const EXAMPLES = [
  "Did drug X reduce major cardiovascular events by 30%?",
  "What's the overall evidence that statins prevent stroke?",
  "Is the claim 'this therapy halves mortality in all patients' accurate?",
];

let turnSeq = 0;
function nextId(): string {
  turnSeq += 1;
  return `turn-${turnSeq}-${Date.now()}`;
}

export default function CopilotPage() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
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
      const userTurn: ChatTurn = { id: nextId(), role: "user", content: trimmed };

      // Snapshot the conversation (including this new user turn) as the wire payload.
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setInput("");
      setLoading(true);

      const payloadMessages = nextTurns.map((t) => ({ role: t.role, content: t.content }));

      try {
        const orgId =
          typeof window !== "undefined" ? window.localStorage.getItem("pt_active_org") : null;
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(orgId ? { "x-org-id": orgId } : {}),
          },
          body: JSON.stringify({ messages: payloadMessages }),
        });
        const body = (await res.json().catch(() => null)) as ApiResponse<CopilotResponse> | null;
        if (!body) {
          throw new Error("Unexpected server response.");
        }
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? "The copilot request failed.");
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
        setError(err instanceof Error ? err.message : "Failed to reach the copilot.");
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
        title="Research Copilot"
        subtitle="Ask about a claim or a body of evidence. Claude drives PaperTrail's verification and synthesis engines — every answer shows its tool trace and grounded sources."
      />

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink/15 bg-paper">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="max-w-md text-sm text-ink/40">
                Start by asking about a specific efficacy claim, or the overall weight of
                evidence for a treatment. The copilot only cites sources its tools retrieve —
                if it can&apos;t ground an answer, it will say so.
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
                Reasoning over the evidence…
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
              placeholder="Ask about a claim or a body of evidence…"
              aria-label="Ask about a claim or a body of evidence"
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
