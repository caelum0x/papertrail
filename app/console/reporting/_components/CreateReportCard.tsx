import Link from "next/link";

interface CreateReportCardProps {
  canEdit: boolean;
}

// Call-to-action card on the reporting landing page. Links editors into the
// builder; non-editors see a disabled, explanatory variant.
export function CreateReportCard({ canEdit }: CreateReportCardProps) {
  if (!canEdit) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-paper p-5">
        <h2 className="text-sm font-semibold text-ink/70">Create a report</h2>
        <p className="mt-1 text-sm text-ink/40">
          You need editor access to build new reports. Ask an admin to grant it.
        </p>
      </div>
    );
  }

  return (
    <Link
      href="/console/reporting/builder"
      className="block rounded-lg border border-ink/15 bg-white p-5 transition hover:border-accent hover:shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink/80">Create a report</h2>
      <p className="mt-1 text-sm text-ink/40">
        Design a layout, set filters, and preview the composed result before
        saving it as a reusable definition.
      </p>
      <span className="mt-3 inline-flex text-sm font-medium text-accent">
        Open the builder →
      </span>
    </Link>
  );
}
