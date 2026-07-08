"use client";

// New-ticket form used on the tickets page and the dedicated new/ route. Split
// into field groups. Submits to POST /api/support/tickets and calls onCreated
// with the new ticket id on success.
import { useState } from "react";
import {
  apiSend,
  PRIORITY_LABELS,
  type TicketPriority,
  type SupportTicketDto,
} from "@/app/console/help/api";

const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export function NewTicketForm({
  onCreated,
  onCancel,
}: {
  onCreated: (ticket: SupportTicketDto) => void;
  onCancel?: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = subject.trim().length >= 3 && body.trim().length >= 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    const res = await apiSend<SupportTicketDto>(
      "/api/support/tickets",
      "POST",
      { subject: subject.trim(), body: body.trim(), priority }
    );
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create ticket.");
      return;
    }
    onCreated(res.data);
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-ink/10 rounded-lg p-5 space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-ink/70 mb-1">
          Subject
        </label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Brief summary of the issue"
          className="w-full text-sm bg-paper border border-ink/10 rounded px-3 py-2 text-ink/80 outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink/70 mb-1">
          Priority
        </label>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`text-xs rounded px-2.5 py-1 border ${
                priority === p
                  ? "border-accent text-accent bg-accent/5"
                  : "border-ink/10 text-ink/60 hover:border-ink/20"
              }`}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink/70 mb-1">
          Details
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={10000}
          placeholder="Describe what happened, what you expected, and any steps to reproduce."
          className="w-full text-sm bg-paper border border-ink/10 rounded px-3 py-2 text-ink/80 outline-none focus:border-accent resize-y"
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!valid || submitting}
          className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Creating..." : "Create ticket"}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-ink/60 hover:text-ink/80"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
