// Status pill shared by workflow run tables and the run trace header.

const RUN_STATUS_STYLES: Record<string, string> = {
  succeeded: "bg-green-50 text-green-700 border-green-600/30",
  failed: "bg-red-50 text-red-700 border-red-600/30",
  running: "bg-amber-50 text-amber-700 border-amber-600/30",
  skipped: "bg-paper text-ink/40 border-ink/15",
  pending: "bg-paper text-ink/40 border-ink/15",
};

interface RunStatusProps {
  status: string;
}

export function RunStatus({ status }: RunStatusProps) {
  const cls = RUN_STATUS_STYLES[status] ?? "bg-paper text-ink/50 border-ink/15";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {status}
    </span>
  );
}
