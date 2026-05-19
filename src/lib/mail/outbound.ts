import type { MailSender } from "./types.js";
import { SmtpSender } from "./adapters/smtp.js";
import { FileSender } from "./adapters/file.js";

export { type MailSender } from "./types.js";

export function createMailSender(envPrefix = "MUSTER"): MailSender {
  if (process.env[`${envPrefix}_SMTP_HOST`]) return new SmtpSender(envPrefix);
  return new FileSender();
}
