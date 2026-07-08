"use client";

import { useState } from "react";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { ToolsHeader } from "./_components/ToolsHeader";
import { ToolGrid } from "./_components/ToolGrid";
import { TryItPanel } from "./_components/TryItPanel";
import { useTools } from "./_components/useTools";
import { canRunTools, type Tool } from "./_components/types";

export default function ToolsPage() {
  const { role, loading: roleLoading } = useCurrentRole();
  const canRun = canRunTools(role);

  const { tools, loading, error } = useTools();
  const [active, setActive] = useState<Tool | null>(null);

  return (
    <div>
      <ToolsHeader
        title="Tools"
        subtitle={
          <>
            PaperTrail&apos;s verification capabilities exposed as callable tools
            — an MCP-style toolset you can try here or drive from an MCP client
            via the{" "}
            <a
              href="/api/mcp/manifest"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              manifest
            </a>
            .
          </>
        }
        action={{ href: "/console/tools/calls", label: "Call history" }}
      />

      <div className="mt-6">
        <ToolGrid
          tools={tools}
          loading={loading}
          error={error}
          canRun={canRun}
          onTry={setActive}
        />
      </div>

      {active ? (
        <TryItPanel
          tool={active}
          canRun={canRun}
          onClose={() => setActive(null)}
        />
      ) : null}

      {!roleLoading && !canRun ? (
        <p className="mt-4 text-xs text-ink/40">
          You can browse tools, but running them requires an editor role or
          higher.
        </p>
      ) : null}
    </div>
  );
}
