// A realistic, domain-accurate bench-notes example for the one-click "Try an example"
// button. Purely client-side: loading it just sets the textarea value, no API call — a
// first-time user gets to the full structure→ground→save flow in a single click.
//
// This is the transfection + western-blot workflow a translational-research lab actually
// runs (HEK293T, TP53 overexpression, p53 immunoblot), written in the terse, abbreviated,
// slightly out-of-order shorthand a scientist would dictate at the bench. It exercises
// every grounded section (protocol steps, reagents with vendor/cat#, samples, equipment,
// observations, outcomes) so the grounded quotes are visible immediately.
export const EXAMPLE_NOTES =
  "6/12 — thawed HEK293T p12, seeded 2x10^5/well in 6-well plate in DMEM + 10% FBS. " +
  "Next day (~70% confluent) transfected 2ug pcDNA3-TP53 w/ Lipofectamine 3000 (Thermo #L3000015) per Thermo protocol. " +
  "Mock = Lipofectamine, no plasmid, as neg control. 48h harvested in RIPA + protease inhibitor, spun 14k 10min 4C. " +
  "BCA for protein, loaded 30ug/lane on 10% SDS-PAGE, transferred to PVDF 90min. " +
  "Blocked 5% milk 1h RT, anti-p53 (CST #9282, 1:1000) o/n 4C, anti-rabbit HRP 1:2000 1h RT. " +
  "ECL, imaged on ChemiDoc. Strong band ~53kDa in transfected lane, none in mock. " +
  "Reprobed for GAPDH loading ctrl — even across lanes. " +
  "Looks like TP53 overexpression worked cleanly. Next: repeat w/ dose curve (0.5/1/2ug) + add apoptosis readout (cleaved caspase-3).";
