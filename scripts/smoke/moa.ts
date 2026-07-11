// Live smoke for the Mixture-of-Agents composition. Proves the artifacts actually FLOW
// between agents: MiniCheck must produce source_labels that MultiVerS/Valsci/STORM consume,
// and quant-extractor must produce effect_sizes that PyMARE pools. Prints the layered DAG,
// the artifact provenance, and the final verdict.
//
//   DOTENV_CONFIG_PATH=.env.vercel.local npx tsx -r dotenv/config scripts/smoke/moa.ts
import { orchestrate } from "../../lib/moa/orchestrate";

async function main(): Promise<void> {
  const claim =
    "Empagliflozin reduced the risk of cardiovascular death by about 35% in patients with type 2 diabetes.";
  const sources = [
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
  ];

  const result = await orchestrate({ claim, sources, options: { llm: true } });

  const line = (s: string) => process.stdout.write(s + "\n");
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

main().catch((err) => {
  process.stderr.write("moa smoke failed: " + String(err) + "\n");
  process.exit(1);
});
