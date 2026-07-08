import Link from "next/link";
import { ImportWizard } from "@/components/import/ImportWizard";

// New-import route: hosts the multi-step ImportWizard.
export default function NewImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/console/import" className="text-xs text-accent hover:underline">
          ← All imports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">New import</h1>
        <p className="mt-1 text-sm text-ink/60">
          Upload a file, map its columns, preview, and commit.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
