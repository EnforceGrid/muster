/**
 * ajv-backed schema validator for every S_*.json contract.
 *
 * Validators are compiled eagerly at import time; mis-typed schemas fail fast
 * on first import rather than at first persisted-row write. Every persistence
 * call site must validate before INSERT — schema is the source of truth, the
 * Postgres column is the cache.
 */

import { Ajv2020, type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import * as addFormatsNs from "ajv-formats";

// ajv-formats ships as CJS; the type-side sees a namespace, the runtime side
// finds the function on `.default`. The cast collapses both cases for callers.
type AddFormatsFn = (ajv: Ajv2020, formats?: string[] | { mode?: "fast" | "full"; formats?: string[] }) => Ajv2020;
const addFormats = (addFormatsNs as unknown as { default: AddFormatsFn }).default
  ?? (addFormatsNs as unknown as AddFormatsFn);
import { SchemaRegistry, type SchemaId } from "../schemas/generated.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false, // schemas use `default`, `description`, etc. ajv is fussy about these in strict mode.
  validateFormats: true,
});
addFormats(ajv);

const validators = new Map<SchemaId, ValidateFunction>();

for (const [id, schema] of Object.entries(SchemaRegistry)) {
  validators.set(id as SchemaId, ajv.compile(schema));
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ErrorObject[]; summary: string };

export function validate(schemaId: SchemaId, row: unknown): ValidationResult {
  const v = validators.get(schemaId);
  if (!v) {
    throw new Error(`No compiled validator for schema "${schemaId}"`);
  }
  const ok = v(row);
  if (ok) return { ok: true };
  const errors = v.errors ?? [];
  const summary = errors
    .slice(0, 5)
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "(no message)"}`)
    .join("; ");
  return { ok: false, errors, summary };
}

export function assertValid(schemaId: SchemaId, row: unknown): void {
  const r = validate(schemaId, row);
  if (!r.ok) {
    throw new Error(`Schema ${schemaId} validation failed: ${r.summary}`);
  }
}
