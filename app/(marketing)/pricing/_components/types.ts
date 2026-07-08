export interface Tier {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: readonly string[];
  cta: string;
  highlighted?: boolean;
}
