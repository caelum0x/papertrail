// Candidate-import panel: paste one record title per line. State owned by page.

interface ImportPanelProps {
  text: string;
  onTextChange: (value: string) => void;
  onImport: () => void;
  importing: boolean;
  message: string | null;
}

export function ImportPanel({
  text,
  onTextChange,
  onImport,
  importing,
  message,
}: ImportPanelProps) {
  return (
    <div className="mt-4 rounded-lg border border-ink/15 bg-white p-6">
      <h2 className="text-sm font-medium text-ink/70">Import candidates</h2>
      <p className="mt-1 text-sm text-ink/40">
        Paste one record title per line. They enter the queue as pending (manual
        source).
      </p>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={5}
        placeholder={"Effect of drug X on outcome Y: a randomized trial\n..."}
        className="mt-3 w-full rounded-md border border-ink/15 bg-white p-3 text-sm text-ink/80 focus:border-accent focus:outline-none"
      />
      {message ? <p className="mt-2 text-sm text-ink/60">{message}</p> : null}
      <button
        onClick={onImport}
        disabled={importing}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {importing ? "Importing..." : "Import"}
      </button>
    </div>
  );
}
