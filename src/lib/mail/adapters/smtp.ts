import nodemailer from "nodemailer";
import type { MailSender, SendOpts } from "../types.js";

export class SmtpSender implements MailSender {
  private transporter: nodemailer.Transporter;
  private p: string;

  constructor(envPrefix = "MUSTER") {
    this.p = envPrefix;
    const port = parseInt(process.env[`${envPrefix}_SMTP_PORT`] ?? "587");
    this.transporter = nodemailer.createTransport({
      host: process.env[`${envPrefix}_SMTP_HOST`]!,
      port,
      secure: process.env[`${envPrefix}_SMTP_SECURE`] === "true",
      ...(process.env[`${envPrefix}_SMTP_USER`]
        ? { auth: { user: process.env[`${envPrefix}_SMTP_USER`], pass: process.env[`${envPrefix}_SMTP_PASS`] } }
        : {}),
    });
  }

  async send(opts: SendOpts): Promise<void> {
    await this.transporter.sendMail({
      from: process.env[`${this.p}_SMTP_FROM`] ?? opts.from,
      to: opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.body,
    });
  }
}
