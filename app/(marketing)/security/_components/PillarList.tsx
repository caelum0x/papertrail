import { PILLARS } from "./data";
import { PillarSection } from "./PillarSection";

export function PillarList() {
  return (
    <>
      {PILLARS.map((pillar) => (
        <PillarSection key={pillar.id} pillar={pillar} />
      ))}
    </>
  );
}
