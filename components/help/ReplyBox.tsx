"use client";

// Reply composer for a ticket thread. Submits to
// POST /api/support/tickets/[id]/messages and calls onPosted with the created
// message so the parent can append it optimistically.
import { useState } from "react";
import { apiSend, type TicketMessageDto } from "@/app/console/help/api";

export function ReplyBox({
  ticketId,
  onPosted,
}: {
  ticketId: string;
  onPosted: (message: TicketMessageDto) => void;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setSubmitting(true);
    setError(null);
    const res = await apiSend<TicketMessageDto>(
      `/api/support/tickets/${ticketId}/messages`,
      "POST",
      { body: trimmed }
    );
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to post reply.");
      return;
    }
    setBody("");
    onPosted(res.data);
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-ink/10 rounded-lg p-4 space-y-3"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={10000}
        placeholder="Write a reply..."
        className="w-full text-sm bg-paper border border-ink/10 rounded px-3 py-2 text-ink/80 outline-none focus:border-accent resize-y"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || body.trim().length === 0}
          className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Sending..." : "Send reply"}
        </button>
      </div>
    </form>
  );
}
