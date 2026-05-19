/**
 * `muster dump-state <assessment_id>` — print the assembled assessment tree.
 *
 * Queries: assessment + organisation + stakeholder_profiles + invitations +
 * interview_threads, assembled into a single JSON tree printed to stdout.
 */
import type { Command } from "commander";
import { sql, closeDb } from "../../lib/db.js";
import { log } from "../../lib/log.js";

interface DbRow {
  payload: unknown;
}

export function registerDumpStateCommand(program: Command): void {
  program
    .command("dump-state <assessment_id>")
    .description("Print the assembled assessment tree.")
    .action(async (assessmentId: string) => {
      try {
        const [assessmentRow] = await sql<[DbRow?]>`
          SELECT a.payload AS assessment, o.payload AS organisation
          FROM assessment a
          JOIN organisation o ON o.id = a.organisation_id
          WHERE a.id = ${assessmentId}
        `;
        if (!assessmentRow) {
          process.stderr.write(`assessment not found: ${assessmentId}\n`);
          process.exitCode = 1;
          return;
        }

        const stakeholders = await sql<{ payload: unknown; invitation_payload: unknown; thread_payload: unknown }[]>`
          SELECT
            sp.payload AS stakeholder,
            inv.payload AS invitation,
            th.payload AS thread
          FROM stakeholder_profile sp
          LEFT JOIN invitation inv
            ON inv.assessment_id = ${assessmentId} AND inv.stakeholder_id = sp.id
          LEFT JOIN interview_thread th
            ON th.assessment_id = ${assessmentId} AND th.stakeholder_id = sp.id
          WHERE sp.assessment_id = ${assessmentId}
          ORDER BY sp.email
        `;

        const tree = {
          assessment: (assessmentRow as unknown as { assessment: unknown }).assessment,
          organisation: (assessmentRow as unknown as { organisation: unknown }).organisation,
          stakeholders: stakeholders.map((r) => ({
            stakeholder: (r as unknown as { stakeholder: unknown }).stakeholder,
            invitation: (r as unknown as { invitation: unknown }).invitation,
            thread: (r as unknown as { thread: unknown }).thread,
          })),
        };

        process.stdout.write(JSON.stringify(tree, null, 2) + "\n");
      } catch (err) {
        log.error("muster.dump-state.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
