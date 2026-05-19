/**
 * DDL for the Muster-active entities.
 *
 * Column names mirror schema-required field names exactly. Top-level required
 * scalar fields get real columns so foreign-key and uniqueness constraints
 * can run in Postgres; everything else lives in `payload jsonb`. The schema-
 * of-record (ajv against `specs/schemas/*.json`) is authoritative — these
 * columns are an indexable cache, not a parallel truth.
 *
 * Muster does NOT create ai_system or evidence_item tables — those are
 * domain-specific to Abra. Muster's job is collection, not extraction.
 *
 * Naming notes:
 *  - `S_policy_envelope` uses `envelope_id` as its primary key in the spec,
 *    not `id`. The column matches.
 *  - `S_invitation` requires `correlation_token` (not `_hash`); the token is
 *    a per-invitation random string, embedded in the Reply-To address. It is
 *    sensitive but not a credential — preserved in plaintext for correlation.
 *  - `S_stakeholder_profile.email` is preserved as plaintext per spec.
 *  - `S_invitation` has no `pending` state; pre-draft intent lives in
 *    `S_stakeholder_profile.invitation_status` ('pending').
 */

import type { Sql } from "postgres";

export async function applySchema(sql: Sql): Promise<void> {
  await sql.unsafe(SCHEMA_SQL);
}

const SCHEMA_SQL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organisation (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  status text NOT NULL,
  coverage_threshold numeric NOT NULL,
  confidence_threshold integer NOT NULL,
  follow_up_budget integer NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS stakeholder_profile (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessment(id),
  email text NOT NULL,
  role_family text NOT NULL,
  invitation_status text NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (assessment_id, email)
);

CREATE TABLE IF NOT EXISTS invitation (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessment(id),
  stakeholder_id uuid NOT NULL REFERENCES stakeholder_profile(id),
  correlation_token text NOT NULL,
  reply_to_address text NOT NULL,
  sent_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (assessment_id, stakeholder_id),
  UNIQUE (correlation_token)
);

CREATE TABLE IF NOT EXISTS interview_thread (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessment(id),
  stakeholder_id uuid NOT NULL REFERENCES stakeholder_profile(id),
  invitation_id uuid NOT NULL REFERENCES invitation(id),
  state text NOT NULL,
  exchange_count integer NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS interview_exchange (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES interview_thread(id),
  direction text NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  raw_body_hash text,
  payload jsonb NOT NULL,
  UNIQUE (thread_id, raw_body_hash)
);

CREATE TABLE IF NOT EXISTS policy_envelope (
  envelope_id uuid PRIMARY KEY,
  envelope_version integer NOT NULL,
  assessment_id uuid NOT NULL REFERENCES assessment(id),
  agent_role text NOT NULL,
  purpose text NOT NULL,
  model_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_event (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessment(id),
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  agent_role text NOT NULL,
  audit_version integer NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_event_assessment_time
  ON audit_event(assessment_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_thread_assessment_state
  ON interview_thread(assessment_id, state);
CREATE INDEX IF NOT EXISTS idx_invitation_assessment
  ON invitation(assessment_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_invitation_status
  ON stakeholder_profile(assessment_id, invitation_status);
`;
