import type {
  ExperimentVariant,
  FeatureFlag,
  FlagEvaluation,
  FlagRule,
} from "@/lib/flags/types";

// Deterministic flag/experiment evaluation. There is NO Math.random here: the
// same (key, subjectId) pair always resolves the same way, so a user's
// experience is stable across requests and across server restarts. This is
// what makes percentage rollouts and sticky experiment assignments coherent.

// FNV-1a 32-bit hash. Small, fast, well-distributed, and dependency-free.
// We hash `${key}:${subjectId}` so the same subject lands in different buckets
// for different flags (a user isn't correlated across every rollout).
export function hashToUnitInterval(key: string, subjectId: string): number {
  const input = `${key}:${subjectId}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Fold to an unsigned 32-bit int, then normalise to [0, 1).
  const unsigned = hash >>> 0;
  return unsigned / 0x100000000;
}

// Bucket a subject into 0..99 for a given key. Stable and uniform.
export function bucketPercent(key: string, subjectId: string): number {
  return Math.floor(hashToUnitInterval(key, subjectId) * 100);
}

// Evaluate a single targeting rule against a subject's attributes.
function ruleMatches(
  rule: FlagRule,
  attributes: Record<string, string>
): boolean {
  const actual = attributes[rule.attribute];
  if (actual === undefined) return false;

  switch (rule.operator) {
    case "equals":
      return typeof rule.value === "string" && actual === rule.value;
    case "not_equals":
      return typeof rule.value === "string" && actual !== rule.value;
    case "in":
      return Array.isArray(rule.value) && rule.value.includes(actual);
    case "contains":
      return typeof rule.value === "string" && actual.includes(rule.value);
    default:
      return false;
  }
}

// Core resolver. Order of precedence:
//   1. If the flag is globally disabled → off.
//   2. First matching rule wins and forces on/off (explicit targeting).
//   3. Otherwise percentage rollout via deterministic bucket.
export function evaluateFlag(
  flag: FeatureFlag,
  subjectId: string,
  attributes: Record<string, string> = {}
): FlagEvaluation {
  const base = { key: flag.key, subjectId };

  if (!flag.enabled) {
    return { ...base, enabled: false, reason: "flag_disabled" };
  }

  for (const rule of flag.rules) {
    if (ruleMatches(rule, attributes)) {
      const on = rule.effect === "on";
      return {
        ...base,
        enabled: on,
        reason: on ? "rule_match_on" : "rule_match_off",
      };
    }
  }

  const percent = Math.max(0, Math.min(100, flag.rolloutPercent));
  if (percent >= 100) {
    return { ...base, enabled: true, reason: "rollout_in" };
  }
  if (percent <= 0) {
    return { ...base, enabled: false, reason: "rollout_out" };
  }

  const bucket = bucketPercent(flag.key, subjectId);
  const inRollout = bucket < percent;
  return {
    ...base,
    enabled: inRollout,
    reason: inRollout ? "rollout_in" : "rollout_out",
  };
}

// Convenience boolean-only form as named in the module spec.
export function isEnabled(
  flag: FeatureFlag,
  subjectId: string,
  attributes: Record<string, string> = {}
): boolean {
  return evaluateFlag(flag, subjectId, attributes).enabled;
}

// Deterministically pick a weighted variant for a subject. Used when an
// experiment has no stored assignment yet. Returns null if there are no
// positively-weighted variants. This mirrors the flag bucketing so assignment
// is reproducible before it is ever persisted.
export function pickVariant(
  experimentKey: string,
  subjectId: string,
  variants: ExperimentVariant[]
): ExperimentVariant | null {
  const weighted = variants.filter((v) => v.weight > 0);
  if (weighted.length === 0) return null;

  const total = weighted.reduce((sum, v) => sum + v.weight, 0);
  if (total <= 0) return null;

  const point = hashToUnitInterval(experimentKey, subjectId) * total;
  let cursor = 0;
  for (const variant of weighted) {
    cursor += variant.weight;
    if (point < cursor) return variant;
  }
  // Floating-point edge: fall back to the last weighted variant.
  return weighted[weighted.length - 1];
}
