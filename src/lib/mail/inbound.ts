import type { MailPoller } from "./types.js";
import { ImapPoller } from "./adapters/imap.js";

export { type MailPoller, type InboundMessage } from "./types.js";

export function createMailPoller(): MailPoller {
  if (!process.env["MUSTER_IMAP_HOST"]) {
    throw new Error("MUSTER_IMAP_HOST is required for inbound mail polling");
  }
  return new ImapPoller();
}
