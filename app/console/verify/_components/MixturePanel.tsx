"use client";

import { useCallback, useState } from "react";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import {
  MOA_SIGNAL_STYLES,
  MOA_VERDICT_STYLES,
  type MoaAgentTrace,
  type MoaResult,
  type MoaSignal,
  type MoaSourceUsed,
  type MoaVerifyClaimData,
} from "./moaTypes";

// OPTIONAL deep path. Self-contained so it can NEVER regress the fast single-source verdict:
// it owns its own claim input echo, fetch, and loading/error/degraded state. On success it
// retrieves cached PubMed / ClinicalTrials.gov sources for the claim server-side (their text
// never leaves the server) and runs the full Mixture-of-Agents composition, then shows the
// mixture verdict, the grounded narrative, and a compact per-agent trace. If the app key is
// usage-capped the route degrades — this panel still renders an honest explanation, never a
// white screen.

const MIN_CLAIM_CHARS = 10;

interface MixturePanelProps {
  // The claim currently in the verify form — the mixture runs on the same text so the two
  // views stay about the same claim.
  claim: string;
}

type PanelState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "empty"; message: string; sourcesUsed: MoaSourceUsed[] }
  | { phase: "done"; result: MoaResult; sourcesUsed: MoaSourceUsed[] };

export function MixturePanel({ claim }: MixturePanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  const trimmedClaim = claim.trim();
  const canRun = trimmedClaim.length >= MIN_CLAIM_CHARS && state.phase !== "loading";

  const run = useCallback(async () => {
    if (trimmedClaim.length < MIN_CLAIM_CHARS) return;
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/moa/verify-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: trimmedClaim, options: { llm: true } }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: MoaVerifyClaimData; error?: string }
        | null;

      if (!body || !res.ok || body.success !== true || !body.data) {
        const isCap = res.status === 429 || res.status === 503;
        setState({
          phase: "error",
          message:
            body?.error ??
            (isCap
              ? "The mixture is over its usage limit right now. Your fast single-source verdict above is unaffected — it needs no retrieval. Please retry the deep mixture in a moment."
              : "The deep mixture could not run for this claim. Your fast verdict above is unaffected."),
        });
        return;
      }

      const data = body.data;
      if (!data.result) {
        setState({
          phase: "empty",
          message:
            data.message ??
            "No cached sources matched this claim, so the mixture had nothing to compose. The fast single-source verdict above still stands.",
          sourcesUsed: data.sourcesUsed ?? [],
        });
        return;
      }
      setState({ phase: "done", result: data.result, sourcesUsed: data.sourcesUsed ?? [] });
    } catch {
      setState({
        phase: "error",
        message:
          "Couldn't reach the mixture service. Your fast single-source verdict above is unaffected — retry the deep mixture when you're back online.",
      });
    }
  }, [trimmedClaim]);

  const toggleOpen = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className="rounded-lg border border-ink/15 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={toggleOpen}
            className="flex items-center gap-2 text-sm font-semibold text-ink"
            aria-expanded={open}
          >
            <span className="text-ink/40">{open ? "▾" : "▸"}</span>
            Deep multi-source mixture
            <span className="rounded-full border border-ink/15 bg-paper/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink/45">
              Optional
            </span>
          </button>
          <p className="mt-1 pl-6 text-xs text-ink/50">
            Cross-check this claim against every cached source with the full Mixture-of-Agents,
            not just the one you pasted. Deterministic verdict + trust; Claude only writes the
            narrative. Slower and needs cached sources — the fast verdict above is the primary
            answer.
          </p>
        </div>
        {open ? (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!canRun}
            className="shrink-0 rounded-md border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {state.phase === "loading" ? "Composing…" : "Run deep mixture"}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 border-t border-ink/10 p-4">
          {state.phase === "idle" ? (
            <p className="text-xs text-ink/45">
              Run the deep mixture to see how the wider cached evidence base votes on this claim.
            </p>
          ) : null}
          {state.phase === "loading" ? (
            <LoadingBanner message="Retrieving cached sources for this claim and composing the mixture of agents…" />
          ) : null}
          {state.phase === "error" ? <ErrorBanner message={state.message} /> : null}
          {state.phase === "empty" ? (
            <div className="rounded-md border border-ink/15 bg-paper/40 p-3 text-xs text-ink/60">
              {state.message}
            </div>
          ) : null}
          {state.phase === "done" ? (
            <MixtureResult result={state.result} sourcesUsed={state.sourcesUsed} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MixtureResult({
  result,
  sourcesUsed,
}: {
  result: MoaResult;
  sourcesUsed: readonly MoaSourceUsed[];
}) {
  const style = MOA_VERDICT_STYLES[result.aggregate.verdict];
  const ranAgents = result.agents.filter((a) => a.contribution.ran);
  return (
    <div className="space-y-3">
      <div className={`rounded-md border p-3 ${style.className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">{style.label}</span>
          <span className="text-xs font-medium">Trust {result.aggregate.trust}/100</span>
        </div>
        {result.narrative ? (
          <p className="mt-2 text-xs leading-relaxed text-ink/70">{result.narrative}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink/50">
          <span>agreement {(result.aggregate.agreement * 100).toFixed(0)}%</span>
          <span>voted {result.aggregate.counts.voted}</span>
          <span>ran {result.aggregate.counts.ran}</span>
          <span>
            mass +{result.aggregate.mass.supports} / -{result.aggregate.mass.refutes} / ~
            {result.aggregate.mass.mixed}
          </span>
          <span>{result.usedClaude ? "Claude: narrative only" : "Claude: off"}</span>
        </div>
      </div>

      {sourcesUsed.length > 0 ? (
        <div className="rounded-md border border-ink/10 bg-paper/40 p-3">
          <p className="text-xs font-medium text-ink/50">
            Composed over {sourcesUsed.length} cached source
            {sourcesUsed.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1.5 space-y-1">
            {sourcesUsed.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2 text-xs text-ink/60">
                <span className="rounded bg-white px-1 py-0.5 text-[10px] text-ink/40">
                  {s.source_type}
                </span>
                <span className="truncate">{s.title ?? s.id}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ranAgents.length > 0 ? (
        <div className="rounded-md border border-ink/10 p-3">
          <p className="text-xs font-medium text-ink/50">
            Agent votes ({ranAgents.length} ran)
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ranAgents.map((a) => (
              <AgentVoteRow key={a.agentId} agent={a} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentVoteRow({ agent }: { agent: MoaAgentTrace }) {
  const c = agent.contribution;
  const signalClass = MOA_SIGNAL_STYLES[c.signal as MoaSignal] ?? "bg-ink/10 text-ink/50";
  return (
    <div className="rounded border border-ink/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-ink/80">{agent.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${signalClass}`}>
          {c.signal}
        </span>
      </div>
      {c.summary ? (
        <p className="mt-1 text-[11px] leading-snug text-ink/55">{c.summary}</p>
      ) : null}
      {c.groundedSpans.length > 0 ? (
        <blockquote className="mt-1 border-l-2 border-accent/40 pl-2 text-[11px] italic text-ink/50">
          “{c.groundedSpans[0].text.slice(0, 160)}
          {c.groundedSpans[0].text.length > 160 ? "…" : ""}”
        </blockquote>
      ) : null}
    </div>
  );
}
