/**
 * A_interviewer — drafts the initial invitation email for a stakeholder.
 *
 * Calls callLlm with purpose "interview_question_generation" and a generic
 * system-prompt asking the respondent to describe tools and systems they use.
 * The LLM must return a JSON object: { subject, body, decision }.
 *
 * Decision-support framing: no legal advice, no classification, no domain-
 * specific framing. Information-collection only.
 */
import { createHash } from "node:crypto";
import { callLlm } from "../lib/llm.js";
import { musterConfig } from "../lib/config.js";

export interface InterviewerInput {
  assessment_id: string;
  stakeholder_id: string;
  stakeholder_name?: string;
  stakeholder_email: string;
  stakeholder_role_family: string;
  stakeholder_title?: string;
  organisation_name: string;
  assessment_owner_name: string;
  assessment_owner_email: string;
  idempotency_key: string;
}

export interface InvitationDraft {
  subject: string;
  body: string;
  decision: "send" | "escalate";
  audit_event_id: string;
  envelope_id: string;
}

function buildSystemPrompt(input: InterviewerInput): string {
  const addressee = input.stakeholder_name ?? input.stakeholder_email;
  return `You are the ${musterConfig.appName} Interviewer agent. You compose an initial invitation email to ${addressee} (${input.stakeholder_role_family}${input.stakeholder_title ? ", " + input.stakeholder_title : ""}) at ${input.organisation_name}, in service of a structured information gathering exercise led by ${input.assessment_owner_name}.

You DO NOT provide legal advice. You DO NOT classify systems or draw conclusions about what the stakeholder describes. Your sole purpose is collecting a factual record of tools, systems, and processes the stakeholder uses or has visibility into. Decision-support framing only.

Write a short, professional, respectful email that:
- Introduces the exercise and ${input.assessment_owner_name} as the organiser
- Explains the purpose: building a factual record of tools and systems used across the organisation
- Asks the stakeholder to reply with a short description of any relevant tools, systems, or processes they use or oversee in their work
- Encourages them to describe each item in their own words — what it is, what it does, who uses it
- States that a free-form reply is fine (bullet points, paragraphs, whichever is easiest)
- States no account creation is required — just reply to the email

Output ONLY a JSON object with these fields (no markdown, no explanation):
{
  "subject": "<email subject line>",
  "body": "<full email body, plain text>",
  "decision": "send"
}`;
}

function parseInterviewerResponse(raw: string): { subject: string; body: string; decision: "send" | "escalate" } {
  const stripped = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(stripped) as { subject: string; body: string; decision: string };
    const decision = parsed.decision === "escalate" ? "escalate" as const : "send" as const;
    return { subject: String(parsed.subject), body: String(parsed.body), decision };
  } catch {
    // If the LLM didn't return valid JSON, construct a fallback from the raw text
    const hashSnippet = createHash("sha256").update(raw).digest("hex").slice(0, 8);
    return {
      subject: `Information gathering request — tools and systems you use [${hashSnippet}]`,
      body: raw,
      decision: "send",
    };
  }
}

export async function draftInvitation(input: InterviewerInput): Promise<InvitationDraft> {
  const model = process.env["MUSTER_MODEL_ID"] ?? "gpt-4o-mini";
  const systemPrompt = buildSystemPrompt(input);

  const result = await callLlm({
    agent_role: "A_interviewer",
    purpose: "interview_question_generation",
    model_id: model,
    assessment_id: input.assessment_id,
    stakeholder_context_id: input.stakeholder_id,
    request: {
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Draft the initial invitation email for ${input.stakeholder_name ?? input.stakeholder_email}.`,
        },
      ],
      max_tokens: 1024,
    },
    idempotency_key: input.idempotency_key,
  });

  const { subject, body, decision } = parseInterviewerResponse(result.responseText);
  return { subject, body, decision, audit_event_id: result.audit_event_id, envelope_id: result.envelope_id };
}
