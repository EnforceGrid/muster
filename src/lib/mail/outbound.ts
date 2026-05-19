import type { MailSender } from "./types.js";
import { SmtpSender } from "./adapters/smtp.js";
import { FileSender } from "./adapters/file.js";

export { type MailSender } from "./types.js";

export function createMailSender(): MailSender {
  if (process.env["MUSTER_SMTP_HOST"]) return new SmtpSender();
  return new FileSender();
}
