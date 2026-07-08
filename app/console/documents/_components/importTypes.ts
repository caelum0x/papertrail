// Shared types + helpers for the bulk import flow.

export type ItemStatus =
  | "queued"
  | "uploading"
  | "extracting"
  | "done"
  | "error";

export interface ImportItem {
  file: File;
  status: ItemStatus;
  documentId: string | null;
  pages: number | null;
  chunks: number | null;
  error: string | null;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  extracting: "Extracting",
  done: "Done",
  error: "Failed",
};

export const STATUS_STYLE: Record<ItemStatus, string> = {
  queued: "text-ink/40",
  uploading: "text-ink/60",
  extracting: "text-ink/60",
  done: "text-accent",
  error: "text-red-600",
};

// Reads a File into a base64 string (without the data: prefix) for upload.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}
