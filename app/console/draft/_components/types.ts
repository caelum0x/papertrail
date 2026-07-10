// Client-side type mirror of the drafting API's data payload. Kept as a plain
// re-export of the server result type so the page and its components stay in lock-step
// with lib/drafting/schemas.ts without duplicating the shape.

export type {
  DraftAssistResult,
  VerifiedSentence,
  GroundedQuote,
  DraftSource,
  DraftSectionType,
} from "@/lib/drafting/schemas";

export { DRAFT_SECTION_TYPES } from "@/lib/drafting/schemas";
