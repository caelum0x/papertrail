export interface ChangeEntry {
  title: string;
  tag: "New" | "Improved" | "Security";
  description: string;
}

export interface Release {
  version: string;
  focus: string;
  changes: readonly ChangeEntry[];
}

export const TAG_STYLES: Record<ChangeEntry["tag"], string> = {
  New: "bg-accent/10 text-accent",
  Improved: "bg-ink/5 text-ink/70",
  Security: "bg-ink/10 text-ink",
};
