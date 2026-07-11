// Live smoke for the Mixture-of-Agents composition. Proves the artifacts actually FLOW
// between agents: MiniCheck must produce source_labels that MultiVerS/Valsci/STORM consume,
// and quant-extractor must produce effect_sizes that PyMARE pools. Prints the layered DAG,
// the artifact provenance, and the final verdict.
//
//   DOTENV_CONFIG_PATH=.env.vercel.local npx tsx -r dotenv/config scripts/smoke/moa.ts
import { orchestrate } from "../../lib/moa/orchestrate";

interface Scenario {
  name: string;
  claim: string;
  sources: Array<{ id: string; text: string; journal?: string; year?: number; citations?: number }>;
}

// Scenario A: a class-level mix (different drug in the 2nd source) — STORM should ABSTAIN
// because the 2nd source doesn't address the empagliflozin claim (honest, not a debate).
// Scenario B: a genuinely contested SAME-intervention pair — STORM SHOULD fire (two sides).
const SCENARIOS: Scenario[] = [
  {
    name: "A · class-level mix (2nd source = different drug) — STORM should abstain",
    claim:
      "Empagliflozin reduced the risk of cardiovascular death by about 35% in patients with type 2 diabetes.",
    sources: [
      {
        id: "empa-reg",
        text:
          "In the EMPA-REG OUTCOME trial, empagliflozin reduced the risk of cardiovascular death " +
          "(hazard ratio 0.62, 95% CI 0.49 to 0.77; p<0.001) compared with placebo among 7020 patients " +
          "with type 2 diabetes and established cardiovascular disease over a median 3.1 years.",
        journal: "New England Journal of Medicine",
        year: 2015,
        citations: 9000,
      },
      {
        id: "declare",
        text:
          "In the DECLARE-TIMI 58 trial of 17160 patients with type 2 diabetes, dapagliflozin did not " +
          "significantly reduce cardiovascular death (hazard ratio 0.98, 95% CI 0.82 to 1.17) compared " +
          "with placebo, though it lowered hospitalization for heart failure.",
        journal: "New England Journal of Medicine",
        year: 2019,
        citations: 6000,
      },
    ],
  },
  {
    name: "B · contested SAME intervention — STORM should fire (two grounded sides)",
    claim: "Empagliflozin reduces the risk of cardiovascular death in patients with type 2 diabetes.",
    sources: [
      {
        id: "empa-reg",
        text:
          "In the EMPA-REG OUTCOME trial, empagliflozin reduced the risk of cardiovascular death " +
          "(hazard ratio 0.62, 95% CI 0.49 to 0.77; p<0.001) compared with placebo among 7020 patients " +
          "with type 2 diabetes and established cardiovascular disease.",
        journal: "New England Journal of Medicine",
        year: 2015,
        citations: 9000,
      },
      {
        id: "contra-trial",
        text:
          "In this randomized trial of empagliflozin in 4300 patients with type 2 diabetes, empagliflozin " +
          "did not significantly reduce cardiovascular death (hazard ratio 0.96, 95% CI 0.81 to 1.14; " +
          "p=0.62) compared with placebo over a median 2.8 years of follow-up.",
        journal: "The Lancet",
        year: 2020,
        citations: 400,
      },
    ],
  },
];

async function runScenario(s: Scenario): Promise<void> {
  const result = await orchestrate({ claim: s.claim, sources: s.sources, options: { llm: true } });
  const line = (t: string) => process.stdout.write(t + "\n");
  line("");
  line("################################################################");
  line("# SCENARIO " + s.name);
  line("################################################################");
  line("=== VERDICT ===");
  line(`${result.aggregate.verdict}  trust ${result.aggregate.trust}/100  agreement ${result.aggregate.agreement}`);
  line(`narrative: ${result.narrative}`);
  line("");
  line("=== LAYERS (composition order) ===");
  for (const l of result.layers) line(`  layer ${l.index}: ${l.agentIds.join(", ")}`);
  line("");
  line("=== PROVENANCE (artifact <- producer) ===");
  for (const p of result.provenance) line(`  ${p.kind} <- ${p.agentId}`);
  line("");
  line("=== KEY COMPOSITION CHECKS ===");
  const producedBy = (kind: string) => result.provenance.find((p) => p.kind === kind)?.agentId ?? "(none)";
  const agent = (id: string) => result.agents.find((a) => a.agentId === id);
  const labelsProducer = producedBy("source_labels");
  const mv = agent("multivers");
  const effProducer = producedBy("effect_sizes");
  const pm = agent("pymare");
  line(`  source_labels produced by: ${labelsProducer}  (expect minicheck)`);
  line(`  multivers ran: ${mv?.contribution.ran}  signal ${mv?.contribution.signal}  -> aggregated those labels`);
  line(`  effect_sizes produced by: ${effProducer}  (expect quant-extractor)`);
  line(`  pymare ran: ${pm?.contribution.ran}  signal ${pm?.contribution.signal}  -> pooled those effects`);
  const contested = producedBy("contested");
  const storm = agent("storm");
  line(`  contested produced by: ${contested}  (expect valsci)`);
  line(`  storm ran: ${storm?.contribution.ran}  signal ${storm?.contribution.signal}  -> debated contested`);
  line("");
  line("=== PER-AGENT (ran) ===");
  for (const a of result.agents.filter((x) => x.contribution.ran)) {
    const c = a.contribution;
    const prod = Object.keys(c.produced ?? {});
    line(
      `  [L${a.layer}] ${a.agentId}: ${c.signal} conf=${c.confidence.toFixed(2)}` +
        (prod.length ? ` produces={${prod.join(",")}}` : "") +
        (c.usedClaude ? " [Claude]" : "")
    );
  }
  line("");
  line("=== PER-AGENT (skipped / errored) ===");
  for (const a of result.agents.filter((x) => !x.contribution.ran)) {
    const c = a.contribution;
    line(`  [L${a.layer}] ${a.agentId}: ${c.summary}${c.error ? " | ERROR: " + c.error : ""}`);
  }
}

async function main(): Promise<void> {
  for (const s of SCENARIOS) {
    await runScenario(s);
  }
}

main().catch((err) => {
  process.stderr.write("moa smoke failed: " + String(err) + "\n");
  process.exit(1);
});
