/**
 * callLlm — single mandatory gateway for every LLM call in Muster.
 *
 * Sequence (do NOT reorder):
 *   1. Build S_policy_envelope, assertValid, persist envelope row
 *   2. steerPolicyCheck(envelope) — stub always allows
 *   3. OpenAI SDK call (only when verdict === "allow")
 *   4. Audit event write with kind="llm_call_attempt" and llm_call.policy_envelope_id
 *
 * This file is the ONLY allowed OpenAI import site. eslint.config.mjs
 * enforces this via no-restricted-imports for every other src file.
 */
import { randomUUID, createHash } from "node:crypto";
import OpenAI from "openai";
import { sql } from "./db.js";
import { assertValid } from "./validate.js";
import * as audit from "./audit.js";
import { steerPolicyCheck } from "../tools/steer_policy_check.js";
import type { S_policy_envelope } from "../schemas/generated.js";

export interface CallLlmInput {
  agent_role: string;
  purpose: S_policy_envelope["purpose"];
  model_id: string;
  assessment_id: string;
  request: {
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    max_tokens?: number;
  };
  stakeholder_context_id?: string | null;
  subject_context_id?: string | null;
  tool_context?: string | null;
  idempotency_key?: string;
}

export interface CallLlmResult {
  executed: boolean;
  steer_verdict: "allow" | "transform" | "deny";
  envelope_id: string;
  audit_event_id: string;
  responseText: string;
  response?: unknown;
}

function sha256(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export async function callLlm(input: CallLlmInput): Promise<CallLlmResult> {
  // 1. Build + persist policy envelope (BEFORE provider call)
  const envelope: S_policy_envelope = {
    envelope_id: randomUUID(),
    envelope_version: 1,
    assessment_id: input.assessment_id,
    agent_role: input.agent_role,
    purpose: input.purpose,
    model_id: input.model_id,
    issued_at: new Date().toISOString(),
    stakeholder_context_id: input.stakeholder_context_id ?? null,
    subject_context_id: input.subject_context_id ?? null,
    tool_context: input.tool_context ?? null,
    ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
  };
  assertValid("S_policy_envelope", envelope);
  await sql`
    INSERT INTO policy_envelope
      (envelope_id, envelope_version, assessment_id, agent_role, purpose, model_id, issued_at, payload)
    VALUES (
      ${envelope.envelope_id},
      ${envelope.envelope_version},
      ${envelope.assessment_id},
      ${envelope.agent_role},
      ${envelope.purpose},
      ${envelope.model_id},
      ${envelope.issued_at},
      ${sql.json(envelope as unknown as Parameters<typeof sql.json>[0])}
    )
  `;

  // 2. Steer stub — always allows; real integration is future work.
  const verdict = steerPolicyCheck(envelope);

  // 3. OpenAI call — only executes when verdict === "allow".
  //    Declaration outside the block so completion is accessible in step 4.
  let responseText = "";
  let completion: OpenAI.Chat.ChatCompletion | null = null;
  if (verdict.verdict === "allow") {
    const client = new OpenAI(); // reads OPENAI_API_KEY from env
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(input.request.system
        ? [{ role: "system" as const, content: input.request.system }]
        : []),
      ...input.request.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];
    completion = await client.chat.completions.create({
      model: input.model_id,
      max_tokens: input.request.max_tokens ?? 1024,
      messages,
    });
    responseText = completion.choices[0]?.message?.content ?? "";
  }

  // 4. Audit event — persisted in BOTH allow and deny paths.
  if (verdict.verdict !== "allow") {
    // Deny/transform path: audit the non-execution with envelope linkage.
    const auditId = await audit.writeAuditEvent({
      assessment_id: input.assessment_id,
      kind: "llm_call_attempt",
      agent_role: input.agent_role,
      tool_name: "T_call_llm",
      llm_call: {
        model_id: input.model_id,
        purpose: input.purpose,
        request_hash: sha256(input.request),
        response_hash: null,
        steer_verdict: verdict.verdict,
        steer_rationale: verdict.rationale ?? null,
        policy_envelope_id: envelope.envelope_id,
        transformed: false,
        executed: false,
      },
    });
    return {
      executed: false,
      steer_verdict: verdict.verdict,
      envelope_id: envelope.envelope_id,
      audit_event_id: auditId,
      responseText: "",
    };
  }

  // Allow path: audit the successful execution with envelope linkage.
  const audit_event_id = await audit.writeAuditEvent({
    assessment_id: input.assessment_id,
    kind: "llm_call_attempt",
    agent_role: input.agent_role,
    tool_name: "T_call_llm",
    llm_call: {
      model_id: input.model_id,
      purpose: input.purpose,
      request_hash: sha256(input.request),
      response_hash: sha256(completion),
      steer_verdict: "allow",
      steer_rationale: null,
      policy_envelope_id: envelope.envelope_id,
      transformed: false,
      executed: true,
    },
  });

  return {
    executed: true,
    steer_verdict: "allow",
    envelope_id: envelope.envelope_id,
    audit_event_id,
    responseText,
    response: completion,
  };
}
