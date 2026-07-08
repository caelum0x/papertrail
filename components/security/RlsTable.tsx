import type { RlsTableStatus } from "@/lib/security/types";

// Presentational table of per-table row-level-security status. A table is
// "isolated" when RLS is enabled AND the org-isolation policy is attached.

interface RlsTableProps {
  tables: RlsTableStatus[];
}

function IsolationBadge({ isolated }: { isolated: boolean }) {
  return isolated ? (
    <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
      Isolated
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
      Not isolated
    </span>
  );
}

export function RlsTable({ tables }: RlsTableProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/60">
            <th className="px-4 py-3 font-medium">Table</th>
            <th className="px-4 py-3 font-medium text-center">RLS enabled</th>
            <th className="px-4 py-3 font-medium text-center">Policies</th>
            <th className="px-4 py-3 font-medium text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {tables.map((t) => (
            <tr key={t.table}>
              <td className="px-4 py-3 font-mono text-ink/70">{t.table}</td>
              <td className="px-4 py-3 text-center">
                {t.rls_enabled ? (
                  <span className="text-accent" aria-label="enabled">
                    ✓
                  </span>
                ) : (
                  <span className="text-ink/20" aria-label="disabled">
                    –
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-center text-ink/60">
                {t.policy_count}
              </td>
              <td className="px-4 py-3 text-right">
                <IsolationBadge isolated={t.rls_enabled && t.isolation_policy} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
