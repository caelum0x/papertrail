import type { ReportDefinition } from "@/lib/reporting/types";
import { ReportRow } from "./ReportRow";

interface ReportListProps {
  definitions: ReportDefinition[];
}

// Table of report definitions for the reporting landing page. Composed from
// ReportRow children; the parent page handles loading/empty/error states.
export function ReportList({ definitions }: ReportListProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Type</th>
          <th className="px-4 py-2 font-medium">Layout</th>
          <th className="px-4 py-2 font-medium">Created by</th>
          <th className="px-4 py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {definitions.map((d) => (
          <ReportRow key={d.id} definition={d} />
        ))}
      </tbody>
    </table>
  );
}
