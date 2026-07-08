import { z } from "zod";
import { EXPERIMENT_STATUSES, RULE_OPERATORS } from "@/lib/flags/types";

// Boundary validation for the feature-flags & experiments APIs. Never trust
// request bodies or query strings — parse them through these schemas first.

const keyRegex = /^[a-z0-9][a-z0-9_.-]*$/;

export const flagRuleSchema = z
  .object({
    attribute: z.string().min(1).max(120),
    operator: z.enum(RULE_OPERATORS),
    value: z.union([
      z.string().max(500),
      z.array(z.string().max(500)).max(100),
    ]),
    effect: z.enum(["on", "off"]),
  })
  .superRefine((rule, ctx) => {
    if (rule.operator === "in" && !Array.isArray(rule.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The 'in' operator requires an array value.",
        path: ["value"],
      });
    }
    if (rule.operator !== "in" && Array.isArray(rule.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The '${rule.operator}' operator requires a string value.`,
        path: ["value"],
      });
    }
  });

export const createFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(keyRegex, "Key must be lowercase alphanumeric with _ . or -."),
  description: z.string().max(2000).nullish(),
  enabled: z.boolean().optional().default(false),
  rolloutPercent: z.number().int().min(0).max(100).optional().default(0),
  rules: z.array(flagRuleSchema).max(50).optional().default([]),
});

export const updateFlagSchema = z
  .object({
    description: z.string().max(2000).nullish(),
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    rules: z.array(flagRuleSchema).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No updatable fields provided.",
  });

export const evaluateQuerySchema = z.object({
  key: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
});

export const variantSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(keyRegex, "Variant key must be lowercase alphanumeric with _ . or -."),
  name: z.string().min(1).max(120),
  weight: z.number().int().min(0).max(1000),
});

export const createExperimentSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(keyRegex, "Key must be lowercase alphanumeric with _ . or -."),
  name: z.string().min(1).max(200),
  status: z.enum(EXPERIMENT_STATUSES).optional().default("draft"),
  variants: z
    .array(variantSchema)
    .max(20)
    .optional()
    .default([])
    .superRefine((variants, ctx) => {
      const seen = new Set<string>();
      for (const v of variants) {
        if (seen.has(v.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate variant key: ${v.key}.`,
          });
        }
        seen.add(v.key);
      }
    }),
});

export const updateExperimentSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(EXPERIMENT_STATUSES).optional(),
    variants: z.array(variantSchema).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No updatable fields provided.",
  });

export type CreateFlagInput = z.infer<typeof createFlagSchema>;
export type UpdateFlagInput = z.infer<typeof updateFlagSchema>;
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;
export type UpdateExperimentInput = z.infer<typeof updateExperimentSchema>;
