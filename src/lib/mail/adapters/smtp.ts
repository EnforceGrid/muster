import nodemailer from "nodemailer";
import type { MailSender, SendOpts } from "../types.js";

export class SmtpSender implements MailSender {
  private transporter: nodemailer.Transporter;

  constructor() {
    const port = parseInt(process.env["MUSTER_SMTP_PORT"] ?? "587");
    this.transporter = nodemailer.createTransport({
      host: process.env["MUSTER_SMTP_HOST"]!,
      port,
      secure: process.env["MUSTER_SMTP_SECURE"] === "true",
      ...(process.env["MUSTER_SMTP_USER"]
        ? { auth: { user: process.env["MUSTER_SMTP_USER"], pass: process.env["MUSTER_SMTP_PASS"] } }
        : {}),
    });
  }

  async send(opts: SendOpts): Promise<void> {
    await this.transporter.sendMail({
      from: process.env["MUSTER_SMTP_FROM"] ?? opts.from,
      to: opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.body,
    });
  }
}
