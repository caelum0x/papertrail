export function StatusLoading() {
  return (
    <div className="mt-8 rounded-lg border border-ink/10 bg-white p-6 text-ink/60">
      Checking deployment health&hellip;
    </div>
  );
}

interface StatusErrorProps {
  message: string;
}

export function StatusError({ message }: StatusErrorProps) {
  return (
    <div className="mt-8 rounded-lg border border-red-600/20 bg-white p-6">
      <p className="font-medium text-red-600">{message}</p>
      <p className="mt-1 text-sm text-ink/60">
        The deployment may be down or unreachable. Try reloading in a moment.
      </p>
    </div>
  );
}
