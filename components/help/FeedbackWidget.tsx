"use client";

// Compact feedback form embedded on the help landing page. Submits to
// POST /api/feedback. Handles its own submit/error/success states so the parent
// page stays simple.
import { useState } from "react";
import {
  apiSend,
  FEEDBACK_LABELS,
  type FeedbackKind,
  type FeedbackDto,
} from "@/app/console/help/api";

const KINDS: FeedbackKind[] = ["bug", "idea", "praise", "other"];

export function FeedbackWidget() {
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await apiSend<FeedbackDto>("/api/feedback", "POST", {
      kind,
      message: message.trim(),
    });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error ?? "Failed to submit feedback.");
      return;
    }
    setDone(true);
    setMessage("");
  }

  if (done) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <p className="text-sm text-ink/80">Thanks for the feedback.</p>
        <button
          onClick={() => setDone(false)}
          className="mt-2 text-sm text-accent"
        >
          Send more
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-ink/10 rounded-lg p-5 space-y-3"
    >
      <div>
        <h2 className="text-sm font-medium text-ink/80">Share feedback</h2>
        <p className="mt-0.5 text-xs text-ink/40">
          Tell us what is working or what could be better.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`text-xs rounded px-2.5 py-1 border ${
              kind === k
                ? "border-accent text-accent bg-accent/5"
                : "border-ink/10 text-ink/60 hover:border-ink/20"
            }`}
          >
            {FEEDBACK_LABELS[k]}
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="Your feedback..."
        className="w-full text-sm bg-paper border border-ink/10 rounded px-3 py-2 text-ink/80 outline-none focus:border-accent resize-y"
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting || message.trim().length < 3}
        className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-40"
      >
        {submitting ? "Sending..." : "Send feedback"}
      </button>
    </form>
  );
}
