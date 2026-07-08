import Link from "next/link";
import type { ReportDefinition } from "@/lib/reporting/types";
import { typeLabel, formatDate } from "./format";

interface ReportRowProps {
  definition: ReportDefinition;
}

// One row in the report list table. Links to the definition's detail/runs page.
export function ReportRow({ definition }: ReportRowProps) {
  return (
    <tr className="border-t border-ink/10 hover:bg-paper">
      <td className="px-4 py-3">
        <Link
          href={`/console/reporting/${definition.id}`}
          className="font-medium text-ink/80 hover:text-accent"
        >
          {definition.name}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink/60">{typeLabel(definition.type)}</td>
      <td className="px-4 py-3 text-ink/60">
        {definition.layout.sections.length} section
        {definition.layout.sections.length === 1 ? "" : "s"}
      </td>
      <td className="px-4 py-3 text-ink/50">
        {definition.createdByName ?? "—"}
      </td>
      <td className="px-4 py-3 text-ink/50">{formatDate(definition.createdAt)}</td>
    </tr>
  );
}
