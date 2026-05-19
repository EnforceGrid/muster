import { randomUUID, createHash } from "node:crypto";
import { sql } from "./db.js";
import { assertValid } from "./validate.js";
import { writeAuditEvent } from "./audit.js";
import { log } from "./log.js";
import type { SInterviewExchange } from "../schemas/generated.js";

export interface IngestResult {
  exchange_id: string;
  audit_event_id: string;
  idempotency_hit: boolean;
}

export async function ingestReply(opts: {
  thread_id: string;
  assessment_id: string;
  raw_body: string;
}): Promise<IngestResult> {
  const rawBodyHash = createHash("sha256").update(opts.raw_body).digest("hex");

  const [existing] = await sql<[{ id: string }?]>`
    SELECT id FROM interview_exchange
    WHERE thread_id = ${opts.thread_id} AND raw_body_hash = ${rawBodyHash}
  `;
  if (existing) {
    log.info("muster.ingest.idempotency-hit", { exchange_id: existing.id, thread_id: opts.thread_id });
    return { exchange_id: existing.id, audit_event_id: "", idempotency_hit: true };
  }

  const exchangeId = randomUUID();
  const now = new Date().toISOString();

  const exchange: SInterviewExchange = {
    id: exchangeId,
    thread_id: opts.thread_id,
    direction: "inbound",
    kind: "stakeholder_reply",
    raw_body: opts.raw_body,
    raw_body_hash: rawBodyHash,
    occurred_at: now,
  };
  assertValid("S_interview_exchange", exchange);

  await sql`
    INSERT INTO interview_exchange (id, thread_id, direction, kind, occurred_at, raw_body_hash, payload)
    VALUES (
      ${exchangeId}, ${opts.thread_id}, ${"inbound"}, ${"stakeholder_reply"},
      ${now}, ${rawBodyHash},
      ${sql.json(exchange as unknown as Parameters<typeof sql.json>[0])}
    )
  `;

  const [threadRow] = await sql<[{ exchange_count: number }?]>`
    SELECT exchange_count FROM interview_thread WHERE id = ${opts.thread_id}
  `;
  const newCount = (threadRow?.exchange_count ?? 0) + 1;
  const threadPatch = JSON.stringify({ state: "extracting", exchange_count: newCount, last_inbound_at: now });
  await sql`
    UPDATE interview_thread
    SET state = 'extracting', exchange_count = exchange_count + 1, payload = payload || ${threadPatch}::jsonb
    WHERE id = ${opts.thread_id}
  `;

  const auditEventId = await writeAuditEvent({
    assessment_id: opts.assessment_id,
    kind: "tool_call",
    agent_role: "system",
    tool_name: "T_receive_reply",
    subject_ref: { thread_id: opts.thread_id, exchange_id: exchangeId, raw_body_hash: rawBodyHash },
  });

  const exchangePatch = JSON.stringify({ audit_event_id: auditEventId });
  await sql`
    UPDATE interview_exchange SET payload = payload || ${exchangePatch}::jsonb WHERE id = ${exchangeId}
  `;

  return { exchange_id: exchangeId, audit_event_id: auditEventId, idempotency_hit: false };
}
