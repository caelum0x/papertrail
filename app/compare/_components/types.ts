import { EffectSizeCheck } from "@/components/VerificationView";
import { GroundedSpan } from "@/lib/grounding";
import { ExtractedFinding } from "@/lib/schemas";

export interface VerifyTextResponse {
  status: "verified";
  claim: string;
  source: { title: string | null; url: string; source_type: string; external_id?: string; raw_text: string };
  finding: ExtractedFinding;
  verification: {
    discrepancy_type: string;
    trust_score: number;
    explanation: string;
    flagged_spans: GroundedSpan[];
  };
  effect_size_check?: EffectSizeCheck;
}
