/**
 * `muster ingest-reply --thread <tid> --body-file <path>` — ingest a stakeholder reply.
 *
 * Delegates to ingestReply() from lib/ingest.ts. Idempotency is handled there.
 */
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { sql, closeDb } from "../../lib/db.js";
import { ingestReply } from "../../lib/ingest.js";
import { log } from "../../lib/log.js";

export function registerIngestReplyCommand(program: Command): void {
  program
    .command("ingest-reply")
    .description("Persist an inbound reply into an interview_exchange.")
    .requiredOption("--thread <tid>", "Interview thread UUID")
    .requiredOption("--body-file <path>", "Path to the reply body text file")
    .action(async (opts: { thread: string; bodyFile: string }) => {
      try {
        const rawBody = readFileSync(opts.bodyFile, "utf8");
        const [threadRow] = await sql<[{ assessment_id: string }?]>`
          SELECT assessment_id FROM interview_thread WHERE id = ${opts.thread}
        `;
        if (!threadRow) {
          process.stderr.write(`thread not found: ${opts.thread}\n`);
          process.exitCode = 1;
          return;
        }
        const result = await ingestReply({ thread_id: opts.thread, assessment_id: threadRow.assessment_id, raw_body: rawBody });
        if (result.idempotency_hit) {
          process.stdout.write(`idempotency-hit: exchange_id=${result.exchange_id}\n`);
        } else {
          process.stdout.write(`exchange_id: ${result.exchange_id}\n`);
          process.stdout.write(`audit_event_id: ${result.audit_event_id}\n`);
          process.stdout.write(`thread_state: extracting\n`);
        }
      } catch (err) {
        log.error("muster.ingest-reply.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
