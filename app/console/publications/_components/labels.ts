// Display-label helpers for publication enums, shared across the list, detail,
// and overview sub-pages so the wording stays consistent.

export function typeLabel(type: string): string {
  switch (type) {
    case "manuscript":
      return "Manuscript";
    case "abstract":
      return "Abstract";
    case "poster":
      return "Poster";
    case "slide_deck":
      return "Slide deck";
    default:
      return "Other";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "planning":
      return "Planning";
    case "in_review":
      return "In review";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
