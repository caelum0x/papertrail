import { TIERS } from "./tiers";
import { TierCard } from "./TierCard";

export function TierGrid() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {TIERS.map((tier) => (
        <TierCard key={tier.name} tier={tier} />
      ))}
    </div>
  );
}
