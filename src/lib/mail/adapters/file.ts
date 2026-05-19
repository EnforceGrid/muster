import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailSender, SendOpts } from "../types.js";

export class FileSender implements MailSender {
  private outboxDir: string;

  constructor(outboxDir = join(process.cwd(), "var", "outbox")) {
    this.outboxDir = outboxDir;
  }

  async send(opts: SendOpts): Promise<void> {
    mkdirSync(this.outboxDir, { recursive: true });
    const filename = `${Date.now()}-${opts.to.replace(/[^a-z0-9]/gi, "_")}.eml`;
    const eml = buildEml(opts);
    writeFileSync(join(this.outboxDir, filename), eml, "utf8");
  }
}

function buildEml(opts: SendOpts & { date?: string }): string {
  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Reply-To: ${opts.replyTo}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date ?? new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    opts.body,
  ].join("\r\n");
}
