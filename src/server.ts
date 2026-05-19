/**
 * Muster HTTP server — thin API layer over the same lib functions the CLI uses.
 *
 * Routes:
 *   GET  /health
 *   POST /assessments                      start-assessment (body: org config JSON)
 *   GET  /assessments/:id                  dump-state
 *   POST /assessments/:id/send             send-invitations
 *   POST /threads/:id/replies              ingest-reply (body: { text })
 *   POST /poll                             poll-replies (requires IMAP config)
 *   GET  /assessments/:id/audit            audit-tail
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { randomUUID, randomBytes } from "node:crypto";
import { sql, closeDb } from "./lib/db.js";
import { applySchema } from "./lib/ddl.js";
import { assertValid } from "./lib/validate.js";
import { writeAuditEvent } from "./lib/audit.js";
import { log } from "./lib/log.js";
import { replyToAddress } from "./lib/config.js";
import { ingestReply } from "./lib/ingest.js";
import { draftInvitation } from "./agents/interviewer.js";
import { createMailSender } from "./lib/mail/outbound.js";
import { createMailPoller } from "./lib/mail/inbound.js";
import type { SOrganisation, SAssessment, SStakeholderProfile, SInvitation, SInterviewThread } from "./schemas/generated.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// POST /assessments — body: org config as JSON (same shape as the YAML fixture)
app.post("/assessments", async (c) => {
  const config = await c.req.json() as {
    organisation: {
      name: string; country?: string; industry?: string;
      headcount_band?: SOrganisation["headcount_band"];
      assessment_owner: { name: string; email: string; title?: string };
    };
    assessment?: { coverage_threshold?: number; confidence_threshold?: number; follow_up_budget?: number };
    stakeholders: Array<{ name?: string; email: string; title?: string; role_family: SStakeholderProfile["role_family"] }>;
  };

  const now = new Date().toISOString();
  const orgId = randomUUID();
  const assessmentId = randomUUID();

  const org: SOrganisation = {
    id: orgId, name: config.organisation.name,
    ...(config.organisation.country !== undefined ? { country: config.organisation.country } : {}),
    ...(config.organisation.industry !== undefined ? { industry: config.organisation.industry } : {}),
    ...(config.organisation.headcount_band !== undefined ? { headcount_band: config.organisation.headcount_band } : {}),
    assessment_owner: config.organisation.assessment_owner,
    steer_instance_url: null, mandate_subscription_id: null, created_at: now,
  };
  assertValid("S_organisation", org);
  await sql`INSERT INTO organisation (id, name, created_at, payload) VALUES (${orgId}, ${org.name}, ${now}, ${sql.json(org as unknown as Parameters<typeof sql.json>[0])})`;

  const assessment: SAssessment = {
    id: assessmentId, organisation_id: orgId, status: "draft",
    coverage_threshold: config.assessment?.coverage_threshold ?? 0.8,
    confidence_threshold: config.assessment?.confidence_threshold ?? 70,
    follow_up_budget: config.assessment?.follow_up_budget ?? 3,
    stakeholder_count_invited: config.stakeholders.length,
    stakeholder_count_completed: 0,
    created_at: now, launched_at: null, completed_at: null,
  };
  assertValid("S_assessment", assessment);
  await sql`INSERT INTO assessment (id, organisation_id, status, coverage_threshold, confidence_threshold, follow_up_budget, created_at, payload) VALUES (${assessmentId}, ${orgId}, ${"draft"}, ${assessment.coverage_threshold}, ${assessment.confidence_threshold}, ${assessment.follow_up_budget}, ${now}, ${sql.json(assessment as unknown as Parameters<typeof sql.json>[0])})`;

  const threads: { stakeholder_email: string; thread_id: string }[] = [];

  for (const sh of config.stakeholders) {
    const stakeholderId = randomUUID();
    const invitationId = randomUUID();
    const threadId = randomUUID();
    const correlationToken = randomBytes(16).toString("hex");
    const replyTo = replyToAddress(correlationToken);

    const stakeholder: SStakeholderProfile = {
      id: stakeholderId, assessment_id: assessmentId,
      ...(sh.name !== undefined ? { name: sh.name } : {}),
      email: sh.email,
      ...(sh.title !== undefined ? { title: sh.title } : {}),
      role_family: sh.role_family,
      invitation_status: "pending", completion_status: "not_started",
    };
    assertValid("S_stakeholder_profile", stakeholder);
    await sql`INSERT INTO stakeholder_profile (id, assessment_id, email, role_family, invitation_status, payload) VALUES (${stakeholderId}, ${assessmentId}, ${sh.email}, ${sh.role_family}, ${"pending"}, ${sql.json(stakeholder as unknown as Parameters<typeof sql.json>[0])})`;

    const invitation: SInvitation = {
      id: invitationId, assessment_id: assessmentId, stakeholder_id: stakeholderId,
      correlation_token: correlationToken, reply_to_address: replyTo, sent_at: now,
    };
    assertValid("S_invitation", invitation);
    await sql`INSERT INTO invitation (id, assessment_id, stakeholder_id, correlation_token, reply_to_address, sent_at, payload) VALUES (${invitationId}, ${assessmentId}, ${stakeholderId}, ${correlationToken}, ${replyTo}, ${now}, ${sql.json(invitation as unknown as Parameters<typeof sql.json>[0])})`;

    const thread: SInterviewThread = {
      id: threadId, assessment_id: assessmentId, stakeholder_id: stakeholderId,
      invitation_id: invitationId, state: "awaiting_first_reply", exchange_count: 0,
    };
    assertValid("S_interview_thread", thread);
    await sql`INSERT INTO interview_thread (id, assessment_id, stakeholder_id, invitation_id, state, exchange_count, payload) VALUES (${threadId}, ${assessmentId}, ${stakeholderId}, ${invitationId}, ${"awaiting_first_reply"}, ${0}, ${sql.json(thread as unknown as Parameters<typeof sql.json>[0])})`;

    threads.push({ stakeholder_email: sh.email, thread_id: threadId });
  }

  log.info("muster.api.assessment.created", { assessment_id: assessmentId });
  return c.json({ assessment_id: assessmentId, organisation_id: orgId, threads });
});

// GET /assessments/:id
app.get("/assessments/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await sql<[{ id: string; status: string; payload: unknown }?]>`
    SELECT a.id, a.status, a.payload,
      o.payload AS org_payload
    FROM assessment a JOIN organisation o ON o.id = a.organisation_id
    WHERE a.id = ${id}
  `;
  if (!row) return c.json({ error: "not found" }, 404);

  const stakeholders = await sql`
    SELECT sp.id, sp.email, sp.role_family, sp.invitation_status, sp.payload,
      it.id AS thread_id, it.state AS thread_state, it.exchange_count
    FROM stakeholder_profile sp
    LEFT JOIN interview_thread it ON it.stakeholder_id = sp.id AND it.assessment_id = ${id}
    WHERE sp.assessment_id = ${id}
  `;
  return c.json({ ...row, stakeholders });
});

// POST /assessments/:id/send
app.post("/assessments/:id/send", async (c) => {
  const assessmentId = c.req.param("id");
  const [assessmentRow] = await sql<[{ organisation_id: string; payload: unknown }?]>`
    SELECT organisation_id, payload FROM assessment WHERE id = ${assessmentId}
  `;
  if (!assessmentRow) return c.json({ error: "not found" }, 404);

  const [orgRow] = await sql<[{ payload: { name: string; assessment_owner: { name: string; email: string } } }?]>`
    SELECT payload FROM organisation WHERE id = ${assessmentRow.organisation_id}
  `;
  if (!orgRow) return c.json({ error: "org not found" }, 404);

  const pending = await sql<{
    stakeholder_id: string; stakeholder_email: string;
    stakeholder_payload: { name?: string; title?: string; role_family: string };
    invitation_id: string; invitation_delivery_status: string; invitation_correlation_token: string;
  }[]>`
    SELECT sp.id AS stakeholder_id, sp.email AS stakeholder_email, sp.payload AS stakeholder_payload,
      inv.id AS invitation_id, inv.payload->>'delivery_status' AS invitation_delivery_status,
      inv.correlation_token AS invitation_correlation_token
    FROM stakeholder_profile sp
    JOIN invitation inv ON inv.assessment_id = ${assessmentId} AND inv.stakeholder_id = sp.id
    WHERE sp.assessment_id = ${assessmentId}
  `;

  const sender = createMailSender();
  const results: { email: string; status: string; invitation_id: string }[] = [];

  for (const row of pending) {
    if (row.invitation_delivery_status === "sent") {
      results.push({ email: row.stakeholder_email, status: "skipped", invitation_id: row.invitation_id });
      continue;
    }

    const orgPayload = orgRow.payload;
    const shPayload = row.stakeholder_payload;
    const draft = await draftInvitation({
      assessment_id: assessmentId, stakeholder_id: row.stakeholder_id,
      ...(shPayload.name !== undefined ? { stakeholder_name: shPayload.name } : {}),
      stakeholder_email: row.stakeholder_email, stakeholder_role_family: shPayload.role_family,
      ...(shPayload.title !== undefined ? { stakeholder_title: shPayload.title } : {}),
      organisation_name: orgPayload.name,
      assessment_owner_name: orgPayload.assessment_owner.name,
      assessment_owner_email: orgPayload.assessment_owner.email,
      idempotency_key: `${assessmentId}:${row.stakeholder_id}:invitation_initial`,
    });

    const now = new Date().toISOString();
    await sender.send({
      from: `muster@${process.env["MUSTER_DOMAIN"] ?? "muster.example.com"}`,
      to: row.stakeholder_email,
      replyTo: replyToAddress(row.invitation_correlation_token),
      subject: draft.subject,
      body: draft.body,
    });

    const invPatch = JSON.stringify({ delivery_status: "sent", sent_at: now });
    await sql`UPDATE invitation SET sent_at = ${now}, payload = payload || ${invPatch}::jsonb WHERE id = ${row.invitation_id}`;
    const shPatch = JSON.stringify({ invitation_status: "sent" });
    await sql`UPDATE stakeholder_profile SET invitation_status = 'sent', payload = payload || ${shPatch}::jsonb WHERE id = ${row.stakeholder_id}`;
    await writeAuditEvent({ assessment_id: assessmentId, kind: "external_send", agent_role: "A_interviewer", subject_ref: { invitation_id: row.invitation_id } });

    results.push({ email: row.stakeholder_email, status: "sent", invitation_id: row.invitation_id });
  }

  return c.json({ results });
});

// POST /threads/:id/replies — body: { text: string }
app.post("/threads/:id/replies", async (c) => {
  const threadId = c.req.param("id");
  const { text } = await c.req.json() as { text: string };
  const [threadRow] = await sql<[{ assessment_id: string }?]>`SELECT assessment_id FROM interview_thread WHERE id = ${threadId}`;
  if (!threadRow) return c.json({ error: "thread not found" }, 404);

  const result = await ingestReply({ thread_id: threadId, assessment_id: threadRow.assessment_id, raw_body: text });
  return c.json(result, result.idempotency_hit ? 200 : 201);
});

// POST /poll
app.post("/poll", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { assessment_id?: string };
  const poller = createMailPoller();
  const results: { thread_id: string; exchange_id: string; status: string }[] = [];

  for await (const msg of poller.poll()) {
    const rows = await sql<{ thread_id: string; assessment_id: string }[]>`
      SELECT it.id AS thread_id, it.assessment_id
      FROM invitation inv JOIN interview_thread it ON it.invitation_id = inv.id
      WHERE inv.correlation_token = ${msg.token}
    `;
    if (rows.length === 0) continue;
    const row = rows[0]!;
    if (body.assessment_id && row.assessment_id !== body.assessment_id) continue;

    const result = await ingestReply({ thread_id: row.thread_id, assessment_id: row.assessment_id, raw_body: msg.body });
    results.push({ thread_id: row.thread_id, exchange_id: result.exchange_id, status: result.idempotency_hit ? "duplicate" : "ingested" });
  }

  return c.json({ results });
});

// GET /assessments/:id/audit
app.get("/assessments/:id/audit", async (c) => {
  const id = c.req.param("id");
  const events = await sql`
    SELECT id, kind, occurred_at, agent_role, payload
    FROM audit_event WHERE assessment_id = ${id} ORDER BY occurred_at ASC
  `;
  return c.json({ events, total: events.length });
});

// Boot
await applySchema(sql);
log.info("muster.server.schema.applied", {});

const port = parseInt(process.env["PORT"] ?? "8080");
serve({ fetch: app.fetch, port }, () => {
  log.info("muster.server.listening", { port });
  process.stdout.write(`Muster listening on http://0.0.0.0:${port}\n`);
});

process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});
