import type { TagDto } from "./api";

// Small colored pill for a tag. Presentational and dependency-free so any module
// can render a tag consistently. Optional onRemove renders a detach affordance.

interface TagBadgeProps {
  tag: Pick<TagDto, "name" | "color">;
  onRemove?: () => void;
  size?: "sm" | "md";
}

// Derives a readable text color and a soft tinted background from the tag color.
// We keep the dot at full color and the text at the tag color over a faint bg.
export default function TagBadge({ tag, onRemove, size = "md" }: TagBadgeProps) {
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${pad}`}
      style={{
        color: tag.color,
        borderColor: `${tag.color}40`,
        backgroundColor: `${tag.color}14`,
      }}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      <span className="font-medium">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${tag.name}`}
          className="ml-0.5 leading-none opacity-60 hover:opacity-100"
          style={{ color: tag.color }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
