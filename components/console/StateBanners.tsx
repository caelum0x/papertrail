// Shared page-level state banners for console tool pages (error / loading).
// These use the house Tailwind tokens (bg-paper, text-ink, accent, red-700 for
// errors) so every tool page renders identical error and loading states.
//
// Presentational only — no data flow, no API calls. Pages own their state and
// simply render these when appropriate.

import { SkeletonText } from "./ui";

// Full-width error banner. Uses the house error color (red-700) and is announced
// to assistive tech via role="alert".
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

// Full-width loading banner shown while a request is in flight. Accepts a short
// status message describing what the tool is doing. Renders animated skeleton
// shimmer bars above the message so an in-flight request reads as "working",
// not "stuck". Signature is unchanged so every existing caller keeps working.
export function LoadingBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-ink/15 bg-white p-6"
    >
      <SkeletonText lines={3} />
      <p className="mt-4 text-sm text-ink/50">{message}</p>
    </div>
  );
}
