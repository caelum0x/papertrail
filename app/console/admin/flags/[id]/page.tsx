import { FlagDetail } from "@/components/flags/FlagDetail";

// Feature-flag detail page. The client FlagDetail orchestrator fetches the flag
// and composes the header, rollout controls, rules editor, evaluator, and audit.
export default function FlagDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <FlagDetail flagId={params.id} />
    </div>
  );
}
