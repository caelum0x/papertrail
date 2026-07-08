"use client";

import { useState } from "react";
import type { FeatureFlag, FlagRule, RuleOperator } from "@/lib/flags/types";
import { RULE_OPERATORS } from "@/lib/flags/types";
import { updateFlag } from "@/components/flags/api";

// Targeting rules editor. Each rule forces the flag on/off for subjects whose
// attribute satisfies the operator, taking precedence over the % rollout.
const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  in: "is one of",
  contains: "contains",
};

function emptyRule(): FlagRule {
  return { attribute: "", operator: "equals", value: "", effect: "on" };
}

function serialize(rule: FlagRule): FlagRule {
  if (rule.operator === "in") {
    const parts =
      typeof rule.value === "string"
        ? rule.value.split(",").map((s) => s.trim()).filter(Boolean)
        : rule.value;
    return { ...rule, value: parts };
  }
  return {
    ...rule,
    value: Array.isArray(rule.value) ? rule.value.join(", ") : rule.value,
  };
}

function displayValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

export function RulesEditor({
  flag,
  onUpdated,
}: {
  flag: FeatureFlag;
  onUpdated: (next: FeatureFlag) => void;
}) {
  const [rules, setRules] = useState<FlagRule[]>(() =>
    flag.rules.map((r) => ({ ...r, value: displayValue(r.value) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patchRule(index: number, patch: Partial<FlagRule>) {
    setSaved(false);
    setRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  }

  function addRule() {
    setSaved(false);
    setRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(index: number) {
    setSaved(false);
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    // Validate locally before sending.
    for (const rule of rules) {
      if (!rule.attribute.trim()) {
        setError("Every rule needs an attribute name.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const payload = rules.map(serialize);
    const res = await updateFlag(flag.id, { rules: payload });
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to save rules.");
      return;
    }
    setSaved(true);
    onUpdated(res.data);
    setRules(res.data.rules.map((r) => ({ ...r, value: displayValue(r.value) })));
  }

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Targeting rules</h2>
          <p className="mt-1 text-xs text-ink/50">
            Rules override the rollout for matching subjects. The first matching
            rule wins.
          </p>
        </div>
        <button
          onClick={addRule}
          className="rounded-md border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-paper"
        >
          Add rule
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-ink/10 bg-paper px-3 py-4 text-center text-xs text-ink/40">
          No targeting rules — all subjects follow the rollout percentage.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {rules.map((rule, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-md border border-ink/10 bg-paper/40 p-2 text-sm"
            >
              <input
                value={rule.attribute}
                onChange={(e) => patchRule(i, { attribute: e.target.value })}
                placeholder="attribute"
                className="w-28 rounded border border-ink/10 bg-white px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none"
              />
              <select
                value={rule.operator}
                onChange={(e) =>
                  patchRule(i, { operator: e.target.value as RuleOperator })
                }
                className="rounded border border-ink/10 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
              >
                {RULE_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>
              <input
                value={typeof rule.value === "string" ? rule.value : ""}
                onChange={(e) => patchRule(i, { value: e.target.value })}
                placeholder={rule.operator === "in" ? "a, b, c" : "value"}
                className="flex-1 rounded border border-ink/10 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-ink/40">then</span>
              <select
                value={rule.effect}
                onChange={(e) =>
                  patchRule(i, { effect: e.target.value as "on" | "off" })
                }
                className="rounded border border-ink/10 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
              >
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
              <button
                onClick={() => removeRule(i)}
                className="text-xs text-ink/40 hover:text-red-600"
                aria-label="Remove rule"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved.</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </section>
  );
}
