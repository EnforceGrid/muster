/**
 * Tiny JSON-line structured logger.
 *
 * Format: `{"ts":"ISO","level":"info","event":"…","data":{…}}` per line on stdout.
 * Mirrors every line to `var/audit/run.log` so a kill-resume scenario can
 * reconstruct what the prior process was doing without parsing stdout capture.
 *
 * Not a replacement for the audit event store (`S_audit_event`). That stores
 * domain-meaningful, schema-validated events; this stores debug noise.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const auditDir = join(process.cwd(), "var", "audit");
const auditFile = join(auditDir, "run.log");
let auditReady = false;

function ensureAuditFile(): void {
  if (auditReady) return;
  mkdirSync(auditDir, { recursive: true });
  auditReady = true;
}

function emit(level: Level, event: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  });
  process.stdout.write(line + "\n");
  try {
    ensureAuditFile();
    appendFileSync(auditFile, line + "\n");
  } catch {
    // Audit file failure must not crash the process; the stdout line is the
    // source of truth and external collectors (CI logs) capture it.
  }
}

export const log = {
  debug: (event: string, data: Record<string, unknown> = {}) => emit("debug", event, data),
  info: (event: string, data: Record<string, unknown> = {}) => emit("info", event, data),
  warn: (event: string, data: Record<string, unknown> = {}) => emit("warn", event, data),
  error: (event: string, data: Record<string, unknown> = {}) => emit("error", event, data),
};
