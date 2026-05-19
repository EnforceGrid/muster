/**
 * `muster send-invitations <assessment_id>` — draft + dispatch invitations.
 *
 * For each stakeholder with delivery_status=queued:
 *   1. Call A_interviewer to draft invitation via callLlm
 *   2. Send via configured mail adapter (SMTP or file outbox)
 *   3. Update S_invitation: delivery_status=sent, sent_at=now
 *   4. Update S_stakeholder_profile: invitation_status=sent
 *   5. Write S_audit_event kind=external_send
 *
 * Idempotency: stakeholders with delivery_status=sent are skipped.
 */
import type { Command } from "commander";
import { createHash } from "node:crypto";
import { sql, closeDb } from "../../lib/db.js";
import { writeAuditEvent } from "../../lib/audit.js";
import { log } from "../../lib/log.js";
import { draftInvitation } from "../../agents/interviewer.js";
import { replyToAddress, fromAddress } from "../../lib/config.js";
import { createMailSender } from "../../lib/mail/outbound.js";

interface AssessmentRow {
  id: string;
  organisation_id: string;
  payload: {
    coverage_threshold: number;
    confidence_threshold: number;
    follow_up_budget: number;
  };
}

interface OrgRow {
  payload: {
    name: string;
    assessment_owner: { name: string; email: string };
  };
}

interface PendingRow {
  stakeholder_id: string;
  stakeholder_email: string;
  stakeholder_payload: {
    name?: string;
    title?: string;
    role_family: string;
  };
  invitation_id: string;
  invitation_delivery_status: string;
  invitation_correlation_token: string;
}

export function registerSendInvitationsCommand(program: Command): void {
  program
    .command("send-invitations <assessment_id>")
    .description("Draft + send invitations via configured mail adapter.")
    .action(async (assessmentId: string) => {
      try {
        const [assessmentRow] = await sql<[AssessmentRow?]>`
          SELECT a.id, a.organisation_id, a.payload
          FROM assessment a WHERE a.id = ${assessmentId}
        `;
        if (!assessmentRow) {
          process.stderr.write(`assessment not found: ${assessmentId}\n`);
          process.exitCode = 1;
          return;
        }

        const [orgRow] = await sql<[OrgRow?]>`
          SELECT payload FROM organisation WHERE id = ${assessmentRow.organisation_id}
        `;
        if (!orgRow) {
          process.stderr.write(`organisation not found for assessment: ${assessmentId}\n`);
          process.exitCode = 1;
          return;
        }

        const pending = await sql<PendingRow[]>`
          SELECT
            sp.id                                AS stakeholder_id,
            sp.email                             AS stakeholder_email,
            sp.payload                           AS stakeholder_payload,
            inv.id                               AS invitation_id,
            inv.payload->>'delivery_status'      AS invitation_delivery_status,
            inv.correlation_token                AS invitation_correlation_token
          FROM stakeholder_profile sp
          JOIN invitation inv
            ON inv.assessment_id = ${assessmentId} AND inv.stakeholder_id = sp.id
          WHERE sp.assessment_id = ${assessmentId}
          ORDER BY sp.email
        `;

        const sender = createMailSender();

        let sent = 0;
        let skipped = 0;

        for (const row of pending) {
          if (row.invitation_delivery_status === "sent") {
            log.info("muster.send-invitations.idempotency-hit", {
              stakeholder_id: row.stakeholder_id,
              invitation_id: row.invitation_id,
            });
            skipped++;
            continue;
          }

          const orgPayload = orgRow.payload as OrgRow["payload"];
          const shPayload = row.stakeholder_payload as PendingRow["stakeholder_payload"];

          const idempotencyKey = `${assessmentId}:${row.stakeholder_id}:invitation_initial`;

          const draft = await draftInvitation({
            assessment_id: assessmentId,
            stakeholder_id: row.stakeholder_id,
            ...(shPayload.name !== undefined ? { stakeholder_name: shPayload.name } : {}),
            stakeholder_email: row.stakeholder_email,
            stakeholder_role_family: shPayload.role_family,
            ...(shPayload.title !== undefined ? { stakeholder_title: shPayload.title } : {}),
            organisation_name: orgPayload.name,
            assessment_owner_name: orgPayload.assessment_owner.name,
            assessment_owner_email: orgPayload.assessment_owner.email,
            idempotency_key: idempotencyKey,
          });

          const now = new Date().toISOString();
          const replyTo = replyToAddress(row.invitation_correlation_token);

          await sender.send({
            from: fromAddress(),
            to: row.stakeholder_email,
            replyTo,
            subject: draft.subject,
            body: draft.body,
          });

          const bodyHash = createHash("sha256").update(draft.body).digest("hex");
          const recipientHash = createHash("sha256").update(row.stakeholder_email).digest("hex");

          // Update invitation: sent_at=now (column), delivery_status/body_hash/subject in payload
          const invPatch = JSON.stringify({ delivery_status: "sent", sent_at: now, subject_line: draft.subject, body_hash: bodyHash });
          await sql`
            UPDATE invitation
            SET sent_at = ${now}, payload = payload || ${invPatch}::jsonb
            WHERE id = ${row.invitation_id}
          `;

          // Update stakeholder invitation_status=sent
          const shPatch = JSON.stringify({ invitation_status: "sent" });
          await sql`
            UPDATE stakeholder_profile
            SET invitation_status = 'sent', payload = payload || ${shPatch}::jsonb
            WHERE id = ${row.stakeholder_id}
          `;

          // Write audit event: external_send
          const auditEventId = await writeAuditEvent({
            assessment_id: assessmentId,
            kind: "external_send",
            agent_role: "A_interviewer",
            subject_ref: { stakeholder_id: row.stakeholder_id, invitation_id: row.invitation_id },
            external_send: {
              recipient_hash: recipientHash,
              invitation_id: row.invitation_id,
              message_hash: bodyHash,
            },
          });

          process.stdout.write(`sent: ${row.stakeholder_email} → invitation_id=${row.invitation_id} audit_event_id=${auditEventId}\n`);
          log.info("muster.send-invitations.sent", {
            stakeholder_id: row.stakeholder_id,
            invitation_id: row.invitation_id,
          });
          sent++;
        }

        process.stdout.write(`done: ${sent} sent, ${skipped} skipped (idempotency)\n`);
      } catch (err) {
        log.error("muster.send-invitations.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
