"use client";

import Link from "next/link";

// REVIEWER WALKTHROUGH — the 30-second orientation for a Builder Track judge.
// Introduces the three named users PaperTrail was built for and links to each of
// their tools in one click. Self-contained: no API calls, no new state, pure layout
// matching the console look (bg-paper / ink tokens / accent). The sidebar nav link
// to this page is registered separately in app/console/layout.tsx.

interface PersonaTool {
  /** Short id used only as a React key. */
  key: string;
  /** The named user this tool was built for. */
  persona: string;
  /** One line on who they are and the context they work in. */
  who: string;
  /** The tool's product name. */
  toolName: string;
  /** Destination for the "Open tool" link. */
  href: string;
  /** The concrete job the tool does for them. */
  job: string;
  /** Why that job matters to a translational-research reviewer. */
  why: string;
}

// Ordered bench → clinic → medical affairs: the path a finding travels from
// generation to external claim, which is the story the walkthrough tells.
const TOOLS: readonly PersonaTool[] = [
  {
    key: "lab-notebook",
    persona: "Wet-lab scientist",
    who: "A bench scientist in a translational, disease-focused lab, dictating rough notes between experiments.",
    toolName: "Lab Notebook",
    href: "/console/lab-notebook",
    job: "Turns raw, dictated bench notes into a structured, searchable experiment record — reagents, protocol steps, and outcomes — with no transcription labor.",
    why: "Every field stays grounded to a verbatim quote from the scientist's own words. Anything Claude can't quote is dropped, so the reproducible record never drifts from what actually happened at the bench.",
  },
  {
    key: "trial-matcher",
    persona: "Research coordinator",
    who: "A clinical research coordinator triaging patients against open studies under time pressure.",
    toolName: "Trial Matcher",
    href: "/console/trial-matcher",
    job: "Matches a patient summary against ClinicalTrials.gov studies and explains each eligibility decision criterion by criterion.",
    why: "Each include/exclude call cites the exact eligibility line it came from, so a coordinator can defend a match — or rule one out — without re-reading the full protocol.",
  },
  {
    key: "verify",
    persona: "Medical-affairs reviewer",
    who: "A medical-affairs reviewer signing off on efficacy language before it reaches clinicians or the public.",
    toolName: "Claim Verification",
    href: "/console/verify",
    job: "Traces an efficacy claim back to its primary source, recomputes the effect size, and flags any discrepancy between the claim and what the source actually reported.",
    why: "The flagged spans map to exact substrings of the cached source text, and the effect size is recomputed deterministically — so a reviewer sees provenance, not a model's opinion.",
  },
] as const;

export default function ReviewerWalkthroughPage() {
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          Reviewer walkthrough
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">
          Built Beyond the Bench
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Grounded evidence tools for translational labs — three named users, one tool
          each, following a finding from the bench to the clinic to the claims that go
          out the door.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {TOOLS.map((tool, index) => (
          <article
            key={tool.key}
            className="flex flex-col rounded-lg border border-ink/15 bg-white p-5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                {tool.persona}
              </span>
            </div>

            <h2 className="mt-3 text-lg font-semibold text-ink/80">{tool.toolName}</h2>
            <p className="mt-1 text-sm text-ink/50">{tool.who}</p>

            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink/35">
                  What it does
                </dt>
                <dd className="mt-1 text-sm text-ink/70">{tool.job}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink/35">
                  Why it matters
                </dt>
                <dd className="mt-1 text-sm text-ink/70">{tool.why}</dd>
              </div>
            </dl>

            <div className="mt-5 flex-1" />

            <Link
              href={tool.href}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
            >
              Open tool
              <span aria-hidden="true">&rarr;</span>
            </Link>
            <p className="mt-1 text-xs text-ink/40">
              Includes a one-click &ldquo;Try an example&rdquo; inside.
            </p>
          </article>
        ))}
      </div>

      <section className="max-w-3xl rounded-lg border border-ink/15 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink/70">
          What makes this different
        </h2>
        <p className="mt-2 text-sm text-ink/60">
          Effect sizes are recomputed deterministically, and every claim about a source
          points to a verbatim span of that source&rsquo;s cached text. The model
          summarizes and flags — it never invents a number or a finding that isn&rsquo;t
          quotable back to the primary evidence.
        </p>
      </section>
    </div>
  );
}
