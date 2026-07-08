import { toCsv } from "@/lib/csvExport";
import type { RecentItem } from "./recentShared";

const CSV_COLUMNS = ["id", "claim_text", "discrepancy_type", "trust_score", "created_at"];

export function downloadCsv(items: RecentItem[]): void {
  const rows = items.map((item) => ({
    id: item.id,
    claim_text: item.claim_text,
    discrepancy_type: item.discrepancy_type,
    trust_score: item.trust_score,
    created_at: item.created_at,
  }));
  const blob = new Blob([toCsv(rows, CSV_COLUMNS)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "papertrail-verifications.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
