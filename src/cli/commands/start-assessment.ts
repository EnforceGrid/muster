/**
 * `muster start-assessment` — parse an org-config YAML, persist all bootstrap
 * entities, and print the assessment ID.
 *
 * Entity creation order (FK chain):
 *   organisation → assessment → stakeholder_profile[]
 *   → invitation[] (delivery_status=queued, sent_at=now as placeholder)
 *   → interview_thread[] (state=awaiting_first_reply)
 *
 * The invitation `sent_at` is a creation timestamp; send-invitations updates it and
 * sets delivery_status=sent when the email is actually dispatched.
 */
import type { Command } from "commander";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";
import { sql, closeDb } from "../../lib/db.js";
import { assertValid } from "../../lib/validate.js";
import { log } from "../../lib/log.js";
import { replyToAddress } from "../../lib/config.js";
import type {
  SOrganisation,
  SAssessment,
  SStakeholderProfile,
  SInvitation,
  SInterviewThread,
} from "../../schemas/generated.js";

interface StakeholderInput {
  name?: string;
  email: string;
  title?: string;
  role_family: SStakeholderProfile["role_family"];
}

interface OrgConfig {
  organisation: {
    name: string;
    country?: string;
    industry?: string;
    headcount_band?: SOrganisation["headcount_band"];
    assessment_owner: { name: string; email: string; title?: string };
  };
  assessment: {
    coverage_threshold?: number;
    confidence_threshold?: number;
    follow_up_budget?: number;
  };
  stakeholders: StakeholderInput[];
}

function parseConfig(filePath: string): OrgConfig {
  const raw = readFileSync(filePath, "utf8");
  return yamlLoad(raw) as OrgConfig;
}

function makeCorrelationToken(): string {
  return randomBytes(16).toString("hex");
}

export function registerStartAssessmentCommand(program: Command): void {
  program
    .command("start-assessment")
    .description("Persist organisation + stakeholders + assessment + invitations.")
    .requiredOption("--org-config <path>", "Path to org-config YAML (e.g. fixtures/example-org.yaml)")
    .action(async (opts: { orgConfig: string }) => {
      try {
        const config = parseConfig(opts.orgConfig);
        const now = new Date().toISOString();

        const orgId = randomUUID();
        const assessmentId = randomUUID();

        const org: SOrganisation = {
          id: orgId,
          name: config.organisation.name,
          ...(config.organisation.country !== undefined ? { country: config.organisation.country } : {}),
          ...(config.organisation.industry !== undefined ? { industry: config.organisation.industry } : {}),
          ...(config.organisation.headcount_band !== undefined ? { headcount_band: config.organisation.headcount_band } : {}),
          assessment_owner: config.organisation.assessment_owner,
          steer_instance_url: null,
          mandate_subscription_id: null,
          created_at: now,
        };
        assertValid("S_organisation", org);
        await sql`
          INSERT INTO organisation (id, name, created_at, payload)
          VALUES (${org.id}, ${org.name}, ${org.created_at}, ${sql.json(org as unknown as Parameters<typeof sql.json>[0])})
        `;

        const assessment: SAssessment = {
          id: assessmentId,
          organisation_id: orgId,
          status: "draft",
          coverage_threshold: config.assessment.coverage_threshold ?? 0.8,
          confidence_threshold: config.assessment.confidence_threshold ?? 70,
          follow_up_budget: config.assessment.follow_up_budget ?? 3,
          stakeholder_count_invited: config.stakeholders.length,
          stakeholder_count_completed: 0,
          created_at: now,
          launched_at: null,
          completed_at: null,
        };
        assertValid("S_assessment", assessment);
        await sql`
          INSERT INTO assessment
            (id, organisation_id, status, coverage_threshold, confidence_threshold, follow_up_budget, created_at, payload)
          VALUES (
            ${assessment.id},
            ${assessment.organisation_id},
            ${assessment.status},
            ${assessment.coverage_threshold},
            ${assessment.confidence_threshold},
            ${assessment.follow_up_budget},
            ${assessment.created_at},
            ${sql.json(assessment as unknown as Parameters<typeof sql.json>[0])}
          )
        `;

        for (const sh of config.stakeholders) {
          const stakeholderId = randomUUID();
          const invitationId = randomUUID();
          const threadId = randomUUID();
          const correlationToken = makeCorrelationToken();
          const replyTo = replyToAddress(correlationToken);

          const stakeholder: SStakeholderProfile = {
            id: stakeholderId,
            assessment_id: assessmentId,
            ...(sh.name !== undefined ? { name: sh.name } : {}),
            email: sh.email,
            ...(sh.title !== undefined ? { title: sh.title } : {}),
            role_family: sh.role_family,
            invitation_status: "pending",
            completion_status: "not_started",
          };
          assertValid("S_stakeholder_profile", stakeholder);
          await sql`
            INSERT INTO stakeholder_profile
              (id, assessment_id, email, role_family, invitation_status, payload)
            VALUES (
              ${stakeholder.id},
              ${stakeholder.assessment_id},
              ${stakeholder.email},
              ${stakeholder.role_family},
              ${stakeholder.invitation_status},
              ${sql.json(stakeholder as unknown as Parameters<typeof sql.json>[0])}
            )
          `;

          const invitation: SInvitation = {
            id: invitationId,
            assessment_id: assessmentId,
            stakeholder_id: stakeholderId,
            correlation_token: correlationToken,
            reply_to_address: replyTo,
            delivery_status: "queued",
            sent_at: now,
          };
          assertValid("S_invitation", invitation);
          await sql`
            INSERT INTO invitation
              (id, assessment_id, stakeholder_id, correlation_token, reply_to_address, sent_at, payload)
            VALUES (
              ${invitation.id},
              ${invitation.assessment_id},
              ${invitation.stakeholder_id},
              ${invitation.correlation_token},
              ${invitation.reply_to_address},
              ${invitation.sent_at},
              ${sql.json(invitation as unknown as Parameters<typeof sql.json>[0])}
            )
          `;

          const thread: SInterviewThread = {
            id: threadId,
            assessment_id: assessmentId,
            stakeholder_id: stakeholderId,
            invitation_id: invitationId,
            state: "awaiting_first_reply",
            exchange_count: 0,
            follow_up_round: 0,
            last_inbound_at: null,
            last_outbound_at: null,
            completed_at: null,
          };
          assertValid("S_interview_thread", thread);
          await sql`
            INSERT INTO interview_thread
              (id, assessment_id, stakeholder_id, invitation_id, state, exchange_count, payload)
            VALUES (
              ${thread.id},
              ${thread.assessment_id},
              ${thread.stakeholder_id},
              ${thread.invitation_id},
              ${thread.state},
              ${thread.exchange_count},
              ${sql.json(thread as unknown as Parameters<typeof sql.json>[0])}
            )
          `;

          log.info("muster.start-assessment.stakeholder", {
            stakeholder_id: stakeholderId,
            email: sh.email,
            invitation_id: invitationId,
            thread_id: threadId,
          });
        }

        process.stdout.write(`assessment_id: ${assessmentId}\n`);
        process.stdout.write(`organisation_id: ${orgId}\n`);
        process.stdout.write(`stakeholders: ${config.stakeholders.length}\n`);
        log.info("muster.start-assessment.done", { assessment_id: assessmentId, org: config.organisation.name });
      } catch (err) {
        log.error("muster.start-assessment.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
