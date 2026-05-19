/**
 * Steer policy check — stub.
 *
 * Real Steer integration is future work. For now we always allow and echo the
 * envelope_id back so the wrapper can record the verdict in the audit row.
 */
import type { S_policy_envelope } from "../schemas/generated.js";

export interface SteerVerdict {
  verdict: "allow" | "transform" | "deny";
  envelope_id: string;
  rationale?: string | null;
}

export function steerPolicyCheck(envelope: S_policy_envelope): SteerVerdict {
  return { verdict: "allow", envelope_id: envelope.envelope_id, rationale: null };
}
