"use client";

import { useCallback, useState } from "react";

interface SecretRevealProps {
  title: string;
  hint: string;
  secret: string;
  onDismiss: () => void;
}

// One-time secret display with a copy button. Used after creating an API key
// (and reusable for any create-once credential) — the full value is shown once.
export function SecretReveal({ title, hint, secret, onDismiss }: SecretRevealProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [secret]);

  return (
    <div className="mt-4 bg-white border border-accent/40 rounded-lg p-5">
      <p className="text-sm font-medium text-ink/80">{title}</p>
      <p className="mt-1 text-xs text-ink/40">{hint}</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 text-xs bg-paper rounded px-3 py-2 break-all text-ink/80">
          {secret}
        </code>
        <button
          onClick={onCopy}
          className="text-sm border border-ink/15 rounded px-3 py-2 hover:border-accent shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="mt-3 text-xs text-ink/40 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
