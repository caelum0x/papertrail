"use client";

interface NewKeyRevealProps {
  secret: string;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}

// One-time reveal panel for a freshly created API key secret.
export function NewKeyReveal({
  secret,
  copied,
  onCopy,
  onDismiss,
}: NewKeyRevealProps) {
  return (
    <div className="mt-4 bg-white border border-accent/40 rounded-lg p-5">
      <p className="text-sm font-medium text-ink/80">Copy your new key now</p>
      <p className="mt-1 text-xs text-ink/40">
        This is the only time the full key will be shown. Store it somewhere
        safe.
      </p>
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
