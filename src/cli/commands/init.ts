/**
 * `muster init` — apply DDL to the configured Postgres.
 *
 * Idempotent: every statement is `CREATE … IF NOT EXISTS`. Re-running on a
 * populated database is safe and reports the same exit code.
 */

import type { Command } from "commander";
import { sql, closeDb } from "../../lib/db.js";
import { applySchema } from "../../lib/ddl.js";
import { log } from "../../lib/log.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Apply database schema (idempotent).")
    .action(async () => {
      log.info("muster.init.start", { db: redactedUrl() });
      try {
        await applySchema(sql);
        log.info("muster.init.ok", {});
      } catch (err) {
        log.error("muster.init.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}

function redactedUrl(): string {
  const raw = process.env.DATABASE_URL ?? "postgres://muster:muster@localhost:5434/muster";
  return raw.replace(/:\/\/[^@]+@/, "://***@");
}
