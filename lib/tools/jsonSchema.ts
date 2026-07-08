import { z } from "zod";

// Minimal zod -> JSON-Schema converter, scoped to the shapes the built-in tools
// actually use (objects of strings/numbers/booleans/arrays, optionals, defaults,
// and descriptions). Kept small and dependency-free rather than pulling in a full
// zod-to-json-schema package: the MCP manifest only needs a readable, standard
// description of each tool's input, not exhaustive JSON-Schema coverage.

type JsonSchema = Record<string, unknown>;

// Unwrap the modifier wrappers (optional/default/nullable/effects) to reach the
// underlying type, tracking whether the field is required.
function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; required: boolean } {
  let inner = schema;
  let required = true;
  // Peel wrappers until we hit a concrete type.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (inner instanceof z.ZodOptional) {
      required = false;
      inner = inner.unwrap();
      continue;
    }
    if (inner instanceof z.ZodDefault) {
      required = false;
      inner = inner._def.innerType;
      continue;
    }
    if (inner instanceof z.ZodNullable) {
      inner = inner.unwrap();
      continue;
    }
    if (inner instanceof z.ZodEffects) {
      inner = inner._def.schema;
      continue;
    }
    break;
  }
  return { inner, required };
}

function leafToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const description = schema.description;
  const withDescription = (base: JsonSchema): JsonSchema =>
    description ? { ...base, description } : base;

  if (schema instanceof z.ZodString) return withDescription({ type: "string" });
  if (schema instanceof z.ZodNumber) return withDescription({ type: "number" });
  if (schema instanceof z.ZodBoolean) return withDescription({ type: "boolean" });
  if (schema instanceof z.ZodEnum) {
    return withDescription({ type: "string", enum: [...schema.options] });
  }
  if (schema instanceof z.ZodArray) {
    return withDescription({ type: "array", items: zodToJsonSchema(schema.element) });
  }
  if (schema instanceof z.ZodObject) {
    return zodToJsonSchema(schema);
  }
  // Fallback for anything not modeled above — permissive but honest.
  return withDescription({});
}

// Convert a zod schema to a JSON-Schema-ish object. Object schemas produce
// { type: "object", properties, required }; leaves produce their primitive form.
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const { inner } = unwrap(schema);

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const { inner: fieldInner, required: fieldRequired } = unwrap(fieldSchema);
      properties[key] = leafToJsonSchema(fieldInner);
      if (fieldInner.description && !properties[key].description) {
        properties[key].description = fieldInner.description;
      }
      if (fieldSchema.description && !properties[key].description) {
        properties[key].description = fieldSchema.description;
      }
      if (fieldRequired) required.push(key);
    }
    const result: JsonSchema = { type: "object", properties };
    if (required.length > 0) result.required = required;
    if (inner.description) result.description = inner.description;
    return result;
  }

  const leaf = leafToJsonSchema(inner);
  // Preserve an outer description if the leaf didn't carry one.
  if (schema.description && !leaf.description) leaf.description = schema.description;
  return leaf;
}
