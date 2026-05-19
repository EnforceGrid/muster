/**
 * `muster poll-replies` — poll IMAP mailbox and ingest any new stakeholder replies.
 *
 * Requires MUSTER_IMAP_* environment variables. Each unseen message with a
 * recognized correlation token is ingested via ingestReply(). Messages with
 * unknown tokens are logged and skipped.
 */
import type { Command } from "commander";
import { sql, closeDb } from "../../lib/db.js";
import { ingestReply } from "../../lib/ingest.js";
import { createMailPoller } from "../../lib/mail/inbound.js";
import { log } from "../../lib/log.js";

export function registerPollRepliesCommand(program: Command): void {
  program
    .command("poll-replies")
    .description("Poll IMAP mailbox and ingest any new stakeholder replies.")
    .option("--assessment <id>", "Filter to a specific assessment UUID (optional)")
    .action(async (opts: { assessment?: string }) => {
      try {
        const poller = createMailPoller();
        let ingested = 0;
        let skipped = 0;

        for await (const msg of poller.poll()) {
          // Look up thread via correlation token
          const rows = await sql<{ thread_id: string; assessment_id: string }[]>`
            SELECT it.id AS thread_id, it.assessment_id
            FROM invitation inv
            JOIN interview_thread it ON it.invitation_id = inv.id
            WHERE inv.correlation_token = ${msg.token}
          `;

          if (rows.length === 0) {
            log.warn("muster.poll-replies.unknown-token", { token: msg.token, from: msg.from });
            skipped++;
            continue;
          }

          const row = rows[0]!;

          if (opts.assessment && row.assessment_id !== opts.assessment) {
            skipped++;
            continue;
          }

          const result = await ingestReply({
            thread_id: row.thread_id,
            assessment_id: row.assessment_id,
            raw_body: msg.body,
          });

          if (result.idempotency_hit) {
            log.info("muster.poll-replies.idempotency-hit", { thread_id: row.thread_id });
            skipped++;
          } else {
            process.stdout.write(`ingested: thread=${row.thread_id} exchange=${result.exchange_id} from=${msg.from}\n`);
            log.info("muster.poll-replies.ingested", {
              thread_id: row.thread_id,
              exchange_id: result.exchange_id,
              message_id: msg.messageId,
            });
            ingested++;
          }
        }

        process.stdout.write(`done: ${ingested} ingested, ${skipped} skipped\n`);
      } catch (err) {
        log.error("muster.poll-replies.failed", { message: (err as Error).message });
        process.exitCode = 1;
      } finally {
        await closeDb();
      }
    });
}
