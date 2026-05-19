import type { MailPoller } from "./types.js";
import { ImapPoller } from "./adapters/imap.js";

export { type MailPoller, type InboundMessage } from "./types.js";

export function createMailPoller(envPrefix = "MUSTER"): MailPoller {
  if (!process.env[`${envPrefix}_IMAP_HOST`]) {
    throw new Error(`${envPrefix}_IMAP_HOST is required for inbound mail polling`);
  }
  return new ImapPoller(envPrefix);
}
