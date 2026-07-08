// Small colored badge for an announcement's kind. Purely presentational.
import {
  KIND_LABELS,
  KIND_BADGE_CLASSES,
  type AnnouncementKind,
} from "@/app/console/announcements/api";

export function KindBadge({ kind }: { kind: AnnouncementKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${KIND_BADGE_CLASSES[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}
