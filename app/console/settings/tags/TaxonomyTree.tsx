"use client";

import Link from "next/link";
import { useState } from "react";
import type { TagTreeNodeDto } from "@/components/tags/api";

// Renders the taxonomy as a nested, collapsible tree. Each node links to its
// detail page. A TaxonomyTreeRow component handles a single node + its subtree.

interface TaxonomyTreeProps {
  nodes: TagTreeNodeDto[];
}

function TaxonomyTreeRow({
  node,
  depth,
}: {
  node: TagTreeNodeDto;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="w-4 text-xs text-ink/40 hover:text-ink/80"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: node.color }}
        />
        <Link
          href={`/console/settings/tags/${node.id}`}
          className="text-sm text-ink/80 hover:text-accent"
        >
          {node.name}
        </Link>
        <span className="text-xs text-ink/40">
          {node.usageCount ?? 0} {node.usageCount === 1 ? "use" : "uses"}
        </span>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {node.children.map((child) => (
            <TaxonomyTreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function TaxonomyTree({ nodes }: TaxonomyTreeProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-2">
      <ul>
        {nodes.map((node) => (
          <TaxonomyTreeRow key={node.id} node={node} depth={0} />
        ))}
      </ul>
    </div>
  );
}
