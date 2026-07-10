import Link from "next/link";
import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { DocumentBreadcrumb } from "../_components/DocumentBreadcrumb";
import { Uploader } from "../_components/Uploader";

// Dedicated multi-format upload page: drag-and-drop many files at once. Each file
// is read as base64 and sent to /api/documents/upload; PDFs are extracted in-process
// and other formats are stored as text. Links back to the documents library.

export default function UploadDocumentsPage() {
  return (
    <div>
      <DocumentBreadcrumb leaf="Upload" />

      <div className="mt-2">
        <ModuleHeader
          title="Upload documents"
          subtitle="Drag and drop or choose files. Supported formats: PDF, DOCX, XLSX, XLS, CSV, MD, TXT."
          action={
            <Link
              href="/console/documents"
              className="text-sm text-accent hover:underline"
            >
              Back to documents
            </Link>
          }
        />
      </div>

      <Uploader />
    </div>
  );
}
