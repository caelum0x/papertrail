import { formatCents } from "@/components/billing/apiClient";
import { formatDate, type Invoice } from "./types";

interface InvoicesCardProps {
  invoices: Invoice[];
}

// The invoice-history panel: a compact table of past invoices, or an empty
// state when the org has never been billed.
export function InvoicesCard({ invoices }: InvoicesCardProps) {
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Invoices</h2>
      {invoices.length > 0 ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/40 border-b border-ink/10">
              <th className="py-2 font-normal">Period</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-ink/5">
                <td className="py-2 text-ink/70">
                  {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                </td>
                <td className="py-2 capitalize text-ink/60">{inv.status}</td>
                <td className="py-2 text-right tabular-nums text-ink/80">
                  {formatCents(inv.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-ink/40">No invoices yet.</p>
      )}
    </section>
  );
}
