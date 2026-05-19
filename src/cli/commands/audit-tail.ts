/**
 * `muster audit-tail --assessment <id>` — chronological audit-event log.
 */
import type { Command } from "commander";
import { sql, closeDb } from "../../lib/db.js";
import { log } from "../../lib/log.js";

export function registerAuditTailCommand(program: Command): void {
  program
    .command("audit-tail")
    .description("Render the chronological audit-event log.")
    .requiredOption("--assessment <id>", "Assessment UUID")
    .action(async (opts: { assessment: string }) => {
      try {
        const rows = await sql<{ id: string; kind: string; occurred_at: string; agent_role: string; payload: unknown }[]>`
          SELECT id, kind, occurred_at, agent_role, payload
          FROM audit_event
          WHERE assessment_id = ${opts.assessment}
          ORDER BY occurred_at ASC
        `;
        for (const row of rows) {
          process.stdout.write(JSON.stringify({ id: row.id, kind: row.kind, occurred_at: row.occurred_at, agent_role: row.agent_role }) + "\n");
        }
        process.stdout.write(`total: ${rows.length} event(s)\n`);
      } catch (err) {
        log.error("muster.audit-tail.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
