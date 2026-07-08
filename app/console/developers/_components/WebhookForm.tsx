"use client";

import { useCallback, useState } from "react";
import { AVAILABLE_EVENTS } from "./webhookTypes";

interface WebhookFormProps {
  creating: boolean;
  createError: string | null;
  onCreate: (url: string, events: string[]) => void;
}

// The "Add a webhook" form: URL input + event checkboxes + submit. Owns its own
// transient input state; creation status flows in from the parent hook.
export function WebhookForm({ creating, createError, onCreate }: WebhookFormProps) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([AVAILABLE_EVENTS[0].value]);

  const toggleEvent = useCallback((value: string) => {
    setEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]
    );
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onCreate(url, events);
      // Reset only when the fields were valid enough to attempt a create.
      if (events.length > 0) {
        setUrl("");
        setEvents([AVAILABLE_EVENTS[0].value]);
      }
    },
    [url, events, onCreate]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h2 className="text-sm font-medium text-ink/70">Add a webhook</h2>
      <input
        type="url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/webhooks/papertrail"
        maxLength={2048}
        className="mt-3 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        aria-label="Webhook URL"
      />
      <fieldset className="mt-3">
        <legend className="text-xs text-ink/60">Events</legend>
        <div className="mt-2 flex flex-col gap-2">
          {AVAILABLE_EVENTS.map((ev) => (
            <label
              key={ev.value}
              className="flex items-center gap-2 text-sm text-ink/70"
            >
              <input
                type="checkbox"
                checked={events.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="accent-accent"
              />
              {ev.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={creating}
        className="mt-4 text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {creating ? "Adding..." : "Add webhook"}
      </button>
      {createError ? (
        <p className="mt-2 text-sm text-red-600">{createError}</p>
      ) : null}
    </form>
  );
}
