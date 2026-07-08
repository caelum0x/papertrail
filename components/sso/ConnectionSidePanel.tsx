import type { SsoConnection } from "@/lib/sso/types";
import { PROTOCOL_LABELS } from "@/components/sso/fields";

// Side panel on the connection detail: at-a-glance metadata that doesn't belong
// in a tab. Presentational.

export function ConnectionSidePanel({
  connection,
}: {
  connection: SsoConnection;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Protocol", value: PROTOCOL_LABELS[connection.protocol] ?? connection.protocol },
    { label: "Status", value: connection.status },
    { label: "Domain", value: connection.domain ?? "—" },
    { label: "Verified", value: connection.verified ? "Yes" : "No" },
    {
      label: "Created",
      value: new Date(connection.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <aside className="bg-white border border-ink/10 rounded-lg p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
        Details
      </h2>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3 text-sm">
            <dt className="text-ink/50">{row.label}</dt>
            <dd className="text-ink/80 text-right truncate">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
