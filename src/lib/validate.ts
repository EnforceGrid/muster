/**
 * ajv-backed schema validator.
 *
 * Exports two things:
 *   1. createValidator<T>(registry) — generic factory for any schema registry.
 *      Consumers (e.g. spike/abra) import this and instantiate with their own schemas.
 *   2. validate / assertValid — pre-built for muster's own SchemaRegistry (backward compat).
 */

import { Ajv2020, type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import * as addFormatsNs from "ajv-formats";

// ajv-formats ships as CJS; the type-side sees a namespace, the runtime side
// finds the function on `.default`. The cast collapses both cases for callers.
type AddFormatsFn = (ajv: Ajv2020, formats?: string[] | { mode?: "fast" | "full"; formats?: string[] }) => Ajv2020;
const addFormats = (addFormatsNs as unknown as { default: AddFormatsFn }).default
  ?? (addFormatsNs as unknown as AddFormatsFn);

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ErrorObject[]; summary: string };

export function createValidator<T extends string>(registry: Record<T, object>) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  const validators = new Map<T, ValidateFunction>();
  for (const [id, schema] of Object.entries(registry)) {
    validators.set(id as T, ajv.compile(schema as object));
  }

  function validate(schemaId: T, row: unknown): ValidationResult {
    const v = validators.get(schemaId);
    if (!v) throw new Error(`No compiled validator for schema "${schemaId}"`);
    const ok = v(row);
    if (ok) return { ok: true };
    const errors = v.errors ?? [];
    const summary = errors
      .slice(0, 5)
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "(no message)"}`)
      .join("; ");
    return { ok: false, errors, summary };
  }

  function assertValid(schemaId: T, row: unknown): void {
    const r = validate(schemaId, row);
    if (!r.ok) throw new Error(`Schema ${schemaId} validation failed: ${r.summary}`);
  }

  return { validate, assertValid };
}

// Muster's own pre-built validators — backward compat for muster's internal code.
import { SchemaRegistry, type SchemaId } from "../schemas/generated.js";
export type { SchemaId };
const { validate, assertValid } = createValidator<SchemaId>(SchemaRegistry);
export { validate, assertValid };
