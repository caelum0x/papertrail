"use client";

import { useState } from "react";
import Link from "next/link";

// PUBLIC page (no auth) — the Claude Science integration story, so a judge or a
// scientist can see, without logging in, that PaperTrail is a standalone app that
// CONNECTS TO Claude Science: added as an MCP Connector + a set of Skills, so a
// researcher verifies claims, pools evidence, and matches trials from inside their
// own Claude Science workbench. PaperTrail is not an API layer — it's an app that
// plugs into the app scientists already use.

const CONNECTOR_JSON = `{
  "mcpServers": {
    "papertrail": {
      "command": "node",
      "args": ["/absolute/path/to/papertrail/mcp/dist/server.js"],
      "env": {
        "PAPERTRAIL_BASE_URL": "https://papertrail-topaz-phi.vercel.app"
      }
    }
  }
}`;

const REMOTE_URL = "https://papertrail-topaz-phi.vercel.app/api/mcp";

const SKILLS_REPO = "github.com/caelum0x/papertrail  →  skills/ folder";

const ALLOWED_DOMAIN = "papertrail-topaz-phi.vercel.app";

const CURL = `curl -s https://papertrail-topaz-phi.vercel.app/api/verify \\
  -H 'content-type: application/json' \\
  -d '{"claim":"Drug X reduced major cardiovascular events by 30%"}'`;

interface ToolGroup {
  title: string;
  blurb: string;
  tools: string[];
}

const GROUPS: ToolGroup[] = [
  {
    title: "Verification & fact-check",
    blurb: "Trace a claim to its primary source; recompute the number; ground every span.",
    tools: [
      "verify_claim",
      "verify_claim_batch",
      "verify_text_claims",
      "meta_crosscheck",
      "scientific_claim_eval",
      "fact_check_pipeline",
      "fact_check_document",
      "classify_citation",
      "audit_guideline",
      "draft_with_evidence",
    ],
  },
  {
    title: "Evidence synthesis (deterministic)",
    blurb: "Pool studies with no LLM in the numeric path — oracle-tested biostatistics.",
    tools: [
      "meta_analysis",
      "continuous_meta_analysis",
      "network_meta_analysis",
      "meta_regression",
      "subgroup_analysis",
      "survival_analysis",
      "dose_response_analysis",
      "trial_sequential_analysis",
      "risk_of_bias",
      "evidence_report",
      "evidence_pipeline",
      "effect_size_stats",
    ],
  },
  {
    title: "Biomedical evidence engines",
    blurb: "Deterministic verdicts over open bio-data: FAERS, GWAS, Open Targets, ChEMBL, ClinVar, PharmGKB.",
    tools: [
      "bio_verify_claim",
      "bio_safety_signal",
      "bio_genetic_association",
      "bio_target_disease",
      "bio_bioactivity",
      "bio_variant_pathogenicity",
      "bio_pharmacogenomics",
      "bio_annotate_entities",
      "bio_drug_interaction",
      "bio_repurposing",
      "bio_biomarker",
    ],
  },
  {
    title: "Agentic research & knowledge",
    blurb: "Grounded QA, deep research, mechanism assembly, knowledge graph — every claim cited.",
    tools: [
      "paper_qa",
      "deep_research",
      "research_brief",
      "research_gaps_hypotheses",
      "extract_paper",
      "assemble_mechanism",
      "synthesis_report",
      "knowledge_graph",
      "kg_link_predict",
      "extract_entities",
      "hybrid_retrieval",
      "evidence_dossier",
      "real_world_evidence",
    ],
  },
  {
    title: "Bench & clinic",
    blurb: "The named-user tools — structure a bench notebook, match a patient to trials.",
    tools: ["structure_experiment", "match_patient_to_trials"],
  },
];

const SKILLS: { name: string; desc: string }[] = [
  { name: "papertrail-verify-claim", desc: "Verify an efficacy/magnitude claim against its primary source." },
  { name: "papertrail-evidence-synthesis", desc: "Pool studies into a meta-analysis with a GRADE certainty rating." },
  { name: "papertrail-trial-matcher", desc: "Match de-identified patient notes to eligible ClinicalTrials.gov trials." },
  { name: "papertrail-lab-notebook", desc: "Turn rough bench notes into a structured, grounded experiment record." },
  { name: "papertrail-safety-signal", desc: "Pharmacovigilance PRR/ROR disproportionality from FAERS." },
  { name: "papertrail-target-disease", desc: "Target–disease evidence plus genetic-association support." },
  { name: "papertrail-research-brief", desc: "A grounded deep-research brief with a citation trail." },
  { name: "papertrail-research-gaps", desc: "Grounded research gaps and testable hypotheses." },
];

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-ink/15 bg-white">
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
          className="rounded-md px-2 py-1 text-xs text-accent hover:bg-accent/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-ink/80">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const TOTAL_TOOLS = GROUPS.reduce((n, g) => n + g.tools.length, 0);

export default function ConnectPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mx-auto max-w-3xl text-center">
        <span className="inline-block rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-xs font-medium text-accent">
          Works with Claude Science
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Connect PaperTrail to Claude Science
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink/60">
          PaperTrail is a standalone evidence-verification app. Add it to Anthropic&apos;s Claude
          Science workbench as an <strong className="text-ink/80">MCP connector</strong> and a set of{" "}
          <strong className="text-ink/80">skills</strong>, and a scientist can verify an efficacy claim,
          pool a meta-analysis, screen a variant, or match a patient to trials — in plain language, without
          ever leaving the environment they already work in. Every answer comes back with a deterministic,
          grounded, citation-traced provenance trail.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <a
            href="https://github.com/caelum0x/papertrail/tree/main/mcp"
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-ink/90"
          >
            The MCP package
          </a>
          <Link
            href="/console/copilot"
            className="rounded-lg border border-ink/20 px-5 py-2.5 text-sm font-medium text-ink hover:bg-ink/5"
          >
            Open the live console
          </Link>
        </div>
        <p className="mt-4 text-sm text-ink/40">
          {TOTAL_TOOLS} tools · {SKILLS.length} skills · one connector
        </p>
      </header>

      {/* Setup — every way to connect */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold text-ink">Four ways to connect</h2>
        <p className="mt-2 text-sm text-ink/50">
          Pick one. The hosted Remote URL is fastest — nothing to install.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {/* 1 — Remote URL (recommended) */}
          <div className="rounded-xl border border-accent/30 bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                Recommended
              </span>
              <h3 className="text-base font-semibold text-ink">1 · Remote URL connector</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              In Claude Science: <strong>Connectors → Add connector → Remote URL</strong>, then paste the hosted
              MCP endpoint. No install — all {TOTAL_TOOLS} public tools appear instantly.
            </p>
            <div className="mt-3">
              <CopyBlock label="hosted mcp endpoint" code={REMOTE_URL} />
            </div>
          </div>

          {/* 2 — Local command */}
          <div className="rounded-xl border border-ink/15 bg-white p-5">
            <h3 className="text-base font-semibold text-ink">2 · Local command connector</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              <strong>Connectors → Add connector → Local command</strong>. Build once
              (<code className="rounded bg-ink/5 px-1">cd mcp &amp;&amp; npm install &amp;&amp; npm run build</code>),
              then add this config. Runs the stdio MCP server on your machine (also exposes the two API-key tools).
            </p>
            <div className="mt-3">
              <CopyBlock label="local stdio mcp" code={CONNECTOR_JSON} />
            </div>
          </div>

          {/* 3 — Skills */}
          <div className="rounded-xl border border-ink/15 bg-white p-5">
            <h3 className="text-base font-semibold text-ink">3 · Skills</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              <strong>Skills → Add skill → Import from GitHub</strong> (point at the repo), or{" "}
              <strong>Upload a skill</strong> with any <code className="rounded bg-ink/5 px-1">SKILL.md</code>. The{" "}
              {SKILLS.length} skills route Claude Science to the right PaperTrail tool automatically.
            </p>
            <div className="mt-3">
              <CopyBlock label="skills repo" code={SKILLS_REPO} />
            </div>
          </div>

          {/* 4 — Network allow-list */}
          <div className="rounded-xl border border-ink/15 bg-white p-5">
            <h3 className="text-base font-semibold text-ink">4 · Network allow-list</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              No connector needed for the plain-<code className="rounded bg-ink/5 px-1">curl</code> path:{" "}
              <strong>Network → Allowed domains → Add domain</strong> so Claude&apos;s own code can call the API
              directly during an analysis.
            </p>
            <div className="mt-3">
              <CopyBlock label="allowed domain" code={ALLOWED_DOMAIN} />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
          <h3 className="text-sm font-semibold text-ink">Or call the engine directly</h3>
          <p className="mt-1 mb-3 text-sm text-ink/50">
            Every tool wraps a live, rate-limited endpoint returning a{" "}
            <code className="rounded bg-ink/5 px-1">{"{ success, data, error }"}</code> envelope — the connector is
            optional.
          </p>
          <CopyBlock label="live api — verify a claim" code={CURL} />
        </div>
      </section>

      {/* Tool catalogue */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold text-ink">The tool catalogue</h2>
        <p className="mt-2 text-sm text-ink/50">
          {TOTAL_TOOLS} PaperTrail capabilities, callable by name from inside Claude Science.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-xl border border-ink/15 bg-white p-5">
              <h3 className="text-base font-semibold text-ink">{g.title}</h3>
              <p className="mt-1 text-sm text-ink/50">{g.blurb}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.tools.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-ink/5 px-2 py-1 font-mono text-xs text-ink/70"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold text-ink">The skills</h2>
        <p className="mt-2 text-sm text-ink/50">
          Drop these into <strong>Claude Science → Capabilities → Skills</strong> so the workbench reaches
          for PaperTrail on the right task, automatically.
        </p>
        <div className="mt-6 divide-y divide-ink/10 rounded-xl border border-ink/15 bg-white">
          {SKILLS.map((s) => (
            <div key={s.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="shrink-0 font-mono text-sm text-accent">{s.name}</span>
              <span className="text-sm text-ink/60">{s.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Why */}
      <section className="mt-16 rounded-2xl border border-ink/15 bg-white p-8">
        <h2 className="text-2xl font-semibold text-ink">Why plug PaperTrail in</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">No LLM in the numeric loop</h3>
            <p className="mt-1 text-sm text-ink/60">
              Risk ratios, NNT, I², τ², GRADE — recomputed deterministically and oracle-tested against
              reference tools. The workbench gets a number it can defend.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Exact-span grounding</h3>
            <p className="mt-1 text-sm text-ink/60">
              Every flagged or cited span is a verbatim substring of the source. A span the engine
              can&apos;t locate is dropped — it structurally cannot make an unsourced claim.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Honest abstention</h3>
            <p className="mt-1 text-sm text-ink/60">
              When retrieval finds no confident match it returns <em>no_support_found</em> rather than a
              confident guess. A wrong &quot;confident&quot; answer is worse than an honest &quot;couldn&apos;t verify.&quot;
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
