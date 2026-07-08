"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { scienceGet, scienceSend } from "@/lib/science/apiClient";
import type {
  ScienceMessage,
  SessionDetail,
} from "@/lib/science/clientTypes";
import { MessageThread } from "../_components/MessageThread";
import { MessageComposer } from "../_components/MessageComposer";

export default function ScienceWorkspacePage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<ScienceMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    const res = await scienceGet<SessionDetail>(
      `/api/science/sessions/${sessionId}`
    );
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load session.");
      return;
    }
    setDetail(res.data);
    setMessages(res.data.messages);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!sessionId || !input.trim()) return;
      setSending(true);
      setSendError(null);
      const res = await scienceSend<{
        userMessage: ScienceMessage;
        assistantMessage: ScienceMessage;
      }>(`/api/science/sessions/${sessionId}/messages`, "POST", {
        content: input.trim(),
      });
      setSending(false);
      if (!res.success || !res.data) {
        setSendError(res.error ?? "Failed to send message.");
        // Reload so a saved user message (assistant failure) still appears.
        void load();
        return;
      }
      setMessages((prev) => [
        ...prev,
        res.data!.userMessage,
        res.data!.assistantMessage,
      ]);
      setInput("");
    },
    [sessionId, input, load]
  );

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/console/science" className="text-sm text-accent hover:underline">
          &larr; All sessions
        </Link>
        <div className="flex items-center gap-3">
          {sessionId ? (
            <Link
              href={`/console/science/${sessionId}/artifacts`}
              className="text-sm text-accent hover:underline"
            >
              Artifacts
            </Link>
          ) : null}
          <Link
            href="/console/settings/science"
            className="text-sm text-accent hover:underline"
          >
            Connection settings
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading session...</p>
      ) : error ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : detail ? (
        <div className="mt-4">
          <h1 className="text-2xl font-semibold text-ink/80">
            {detail.session.title}
          </h1>
          {!detail.workbench.configured && detail.workbench.reason ? (
            <p className="mt-2 rounded border border-ink/10 bg-paper px-3 py-2 text-xs text-ink/50">
              {detail.workbench.reason}
            </p>
          ) : null}

          <MessageThread messages={messages} />

          <MessageComposer
            input={input}
            onInputChange={setInput}
            onSubmit={onSend}
            sending={sending}
            error={sendError}
          />
        </div>
      ) : null}
    </div>
  );
}
