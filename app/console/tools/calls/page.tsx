"use client";

import { ToolsHeader } from "../_components/ToolsHeader";
import { CallList } from "../_components/CallList";
import { Pagination } from "../_components/Pagination";
import { useToolCalls } from "../_components/useToolCalls";

export default function ToolCallsPage() {
  const { calls, page, totalPages, loading, error, load } = useToolCalls();

  return (
    <div>
      <ToolsHeader
        title="Tool call history"
        subtitle="Every tool invocation in this organization, newest first."
        action={{ href: "/console/tools", label: "Back to tools" }}
      />

      <CallList calls={calls} loading={loading} error={error} />

      <Pagination
        page={page}
        totalPages={totalPages}
        loading={loading}
        onPage={load}
      />
    </div>
  );
}
