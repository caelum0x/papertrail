import Link from "next/link";
import { FormatGuide } from "../_components/FormatGuide";

// Static guide to the citation formats the references module can import/export.
// No data fetching — pure reference material, so this is a server component.
export default function ReferenceFormatsPage() {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-ink/40">
        <Link href="/console/references" className="hover:text-accent">
          Reference libraries
        </Link>
        <span>/</span>
        <span className="text-ink/60">Formats</span>
      </div>

      <h1 className="mt-2 text-2xl font-semibold text-ink/80">
        Supported citation formats
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        What you can import into and export from a reference library.
      </p>

      <div className="mt-6">
        <FormatGuide />
      </div>
    </div>
  );
}
