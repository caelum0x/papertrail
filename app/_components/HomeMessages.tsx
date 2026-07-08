interface HomeErrorProps {
  message: string;
}

export function HomeError({ message }: HomeErrorProps) {
  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      {message}
    </div>
  );
}

interface NoSupportMessageProps {
  message?: string;
}

export function NoSupportMessage({ message }: NoSupportMessageProps) {
  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-ink/15 bg-white p-4 text-sm text-ink/70">
      {message}
    </div>
  );
}
