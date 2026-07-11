// Live smoke: proves the Loki reranker's grounded Claude relevance pass actually
// fires at full capacity. One source is deliberately off-topic (wrong drug/outcome)
// so a real model call is needed to tag on-topic vs off-topic — a deterministic-only
// run would leave every `relevance` tag null.
//
//   npx tsx -r dotenv/config scripts/smoke/rerank-claude.ts
//   (loads ANTHROPIC_API_KEY from .env.local via dotenv/config)
import { rankByClaimFrame } from "../../lib/agents/contextualRank";

async function main(): Promise<void> {
  const claim = "Empagliflozin reduced cardiovascular death in patients with type 2 diabetes.";
  const sources = [
    {
      id: "empa-reg",
      text:
        "In the EMPA-REG OUTCOME trial, empagliflozin reduced the risk of cardiovascular " +
        "death by 38% (hazard ratio 0.62, 95% CI 0.49-0.77) compared with placebo in " +
        "patients with type 2 diabetes and established cardiovascular disease.",
    },
    {
      id: "off-topic",
      text:
        "Atorvastatin lowered LDL cholesterol levels in a cohort of otherwise healthy " +
        "adults over a 12-week period, with no cardiovascular outcomes reported.",
    },
  ];

  const result = await rankByClaimFrame(claim, sources, { llm: true });

  const summary = result.ranked.map((r) => ({
    id: r.id,
    score: Number(r.score.toFixed(3)),
    claudeOnTopic: r.relevance ? r.relevance.onTopic : null,
    groundedQuote: r.relevance?.groundedQuote ?? null,
  }));

  // ids/counts only — no full source text dumped to logs.
  process.stdout.write(
    JSON.stringify(
      {
        frameSubject: result.frame.subject,
        frameObject: result.frame.object,
        droppedIds: result.droppedIds,
        relevanceUngroundedCount: result.relevanceUngroundedCount,
        ranked: summary,
        claudeActuallyRan: summary.some((s) => s.claudeOnTopic !== null),
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  process.stderr.write("smoke failed: " + String(err) + "\n");
  process.exit(1);
});
