// Textarea composer for sending a message to the research assistant.

interface MessageComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
  error: string | null;
}

export function MessageComposer({
  input,
  onInputChange,
  onSubmit,
  sending,
  error,
}: MessageComposerProps) {
  return (
    <form onSubmit={onSubmit} className="mt-5">
      <textarea
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        maxLength={8000}
        rows={3}
        disabled={sending}
        className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent disabled:bg-paper"
        placeholder="Ask about the literature, request a PubMed query, or describe a claim to trace..."
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-2 flex items-center justify-end">
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="text-sm bg-accent text-white rounded px-4 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {sending ? "Thinking..." : "Send"}
        </button>
      </div>
    </form>
  );
}
