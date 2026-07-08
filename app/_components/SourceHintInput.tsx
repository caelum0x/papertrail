interface SourceHintInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export function SourceHintInput({ value, onChange, disabled }: SourceHintInputProps) {
  return (
    <div className="mt-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Optional: cited source — DOI, PMID, or NCT (verify against that exact paper)"
        className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/35 focus:border-accent/50 focus:outline-none"
      />
    </div>
  );
}
