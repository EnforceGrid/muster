import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import type { MailPoller, InboundMessage } from "../types.js";

export class ImapPoller implements MailPoller {
  private envPrefix: string;

  constructor(envPrefix = "MUSTER") {
    this.envPrefix = envPrefix;
  }

  async *poll(): AsyncGenerator<InboundMessage> {
    const p = this.envPrefix;
    const client = new ImapFlow({
      host: process.env[`${p}_IMAP_HOST`]!,
      port: parseInt(process.env[`${p}_IMAP_PORT`] ?? "993"),
      secure: process.env[`${p}_IMAP_SECURE`] !== "false",
      auth: {
        user: process.env[`${p}_IMAP_USER`]!,
        pass: process.env[`${p}_IMAP_PASS`]!,
      },
      logger: false,
    });

    await client.connect();
    const mailbox = process.env[`${p}_IMAP_MAILBOX`] ?? "INBOX";
    const lock = await client.getMailboxLock(mailbox);

    try {
      // seen: false fetches unseen messages
      for await (const msg of client.fetch({ seen: false }, { source: true, envelope: true, uid: true })) {
        if (!msg.source || !msg.envelope) continue;

        const parsed = await simpleParser(msg.source);

        // Extract correlation token from any To address matching reply+<token>@<domain>
        const toAddrs = (msg.envelope.to ?? []).map((a) => a.address ?? "");
        let token: string | null = null;
        for (const addr of toAddrs) {
          const match = addr.match(/reply\+([a-f0-9]+)@/i);
          if (match?.[1]) { token = match[1]; break; }
        }

        if (!token) continue;

        const body = parsed.text ?? "";
        const from = msg.envelope.from?.[0]?.address ?? "";
        const messageId = msg.envelope.messageId ?? randomUUID();
        const receivedAt = (msg.envelope.date ?? new Date()).toISOString();

        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"], { uid: true });

        yield { token, body, from, messageId, receivedAt };
      }
    } finally {
      lock.release();
      await client.logout();
    }
  }
}
