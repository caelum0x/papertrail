import { EffectSizeCheck, CrossSourceAgreement, CorroboratingSource, RegistryCheck } from "@/components/VerificationView";
import { GroundedSpan } from "@/lib/grounding";
import { ExtractedFinding } from "@/lib/schemas";

export interface VerifyResponse {
  status: "verified" | "no_support_found";
  message?: string;
  verification_id?: string | null;
  claim?: string;
  source?: {
    title: string | null;
    url: string;
    source_type: string;
    external_id?: string;
    phase?: string | null;
    enrollment_count?: number | null;
    raw_text: string;
  };
  finding?: ExtractedFinding;
  verification?: {
    discrepancy_type: string;
    trust_score: number;
    explanation: string;
    flagged_spans: GroundedSpan[];
  };
  effect_size_check?: EffectSizeCheck;
  cross_source_agreement?: CrossSourceAgreement;
  corroborating_sources?: CorroboratingSource[];
  registry_check?: RegistryCheck | null;
}

const REQUEST_TIMEOUT_MS = 20000;

/** One verify attempt with a bounded timeout. Throws on network error or timeout;
 *  resolves with { ok, data } for any HTTP response (including 4xx/5xx JSON). */
export async function fetchVerify(
  claim: string,
  sourceHint?: string
): Promise<{ ok: boolean; data: VerifyResponse & { error?: string } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, source_hint: sourceHint || undefined }),
      signal: controller.signal,
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}
