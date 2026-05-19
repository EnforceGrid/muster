/**
 * Audit event writer.
 *
 * Every persisted row is validated against `S_audit_event.json` before INSERT.
 * The schema's discriminator (`kind`) drives which nested object is required;
 * ajv enforces it, so this module stays dumb about payload variants.
 */

import { randomUUID } from "node:crypto";
import { sql } from "./db.js";
import { assertValid } from "./validate.js";
import type { S_audit_event } from "../schemas/generated.js";

export type AuditEvent = S_audit_event;

export async function writeAuditEvent(
  partial: Omit<AuditEvent, "id" | "audit_version" | "occurred_at"> &
    Partial<Pick<AuditEvent, "id" | "audit_version" | "occurred_at">>
): Promise<string> {
  const row: AuditEvent = {
    id: partial.id ?? randomUUID(),
    audit_version: 1,
    occurred_at: partial.occurred_at ?? new Date().toISOString(),
    ...partial,
  } as AuditEvent;

  assertValid("S_audit_event", row);

  await sql`
    INSERT INTO audit_event (id, assessment_id, kind, occurred_at, agent_role, audit_version, payload)
    VALUES (
      ${row.id},
      ${row.assessment_id},
      ${row.kind},
      ${row.occurred_at},
      ${row.agent_role},
      ${row.audit_version},
      ${sql.json(row as unknown as Parameters<typeof sql.json>[0])}
    )
  `;
  return row.id;
}
