#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { musterConfig } from "../lib/config.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStartAssessmentCommand } from "./commands/start-assessment.js";
import { registerDumpStateCommand } from "./commands/dump-state.js";
import { registerSendInvitationsCommand } from "./commands/send-invitations.js";
import { registerIngestReplyCommand } from "./commands/ingest-reply.js";
import { registerPollRepliesCommand } from "./commands/poll-replies.js";
import { registerAuditTailCommand } from "./commands/audit-tail.js";

const program = new Command();
program
  .name("muster")
  .description(`Structured evidence collection over email (${musterConfig.domain})`)
  .version("0.0.1");

registerInitCommand(program);
registerStartAssessmentCommand(program);
registerDumpStateCommand(program);
registerSendInvitationsCommand(program);
registerIngestReplyCommand(program);
registerPollRepliesCommand(program);
registerAuditTailCommand(program);

await program.parseAsync(process.argv);
