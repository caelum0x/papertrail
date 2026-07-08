"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchPrisma, fetchSrProject } from "../../client";
import type {
  PrismaCounts,
  SrProjectWithCounts,
} from "@/app/api/sr-projects/lib/types";
import { PrismaDiagram } from "../../_components/PrismaDiagram";

export default function PrismaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [project, setProject] = useState<SrProjectWithCounts | null>(null);
  const [counts, setCounts] = useState<PrismaCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [projectResult, countsResult] = await Promise.all([
      fetchSrProject(id),
      fetchPrisma(id),
    ]);
    if (countsResult.error || !countsResult.data) {
      setError(countsResult.error ?? "Failed to load PRISMA counts.");
      setCounts(null);
    } else {
      setCounts(countsResult.data);
    }
    if (projectResult.data) {
      setProject(projectResult.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-2xl">
      <Link
        href={id ? `/console/screening/${id}` : "/console/screening"}
        className="text-sm text-accent hover:underline"
      >
        ← Back to screening
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold text-ink/80">PRISMA flow</h1>
        {project ? (
          <p className="mt-1 text-sm text-ink/40">{project.name}</p>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading PRISMA counts...
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : counts ? (
        <PrismaDiagram counts={counts} />
      ) : null}
    </div>
  );
}
