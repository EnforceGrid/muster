export interface SendOpts {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  body: string;
}

export interface InboundMessage {
  token: string;
  body: string;
  from: string;
  messageId: string;
  receivedAt: string;
}

export interface MailSender {
  send(opts: SendOpts): Promise<void>;
}

export interface MailPoller {
  poll(): AsyncGenerator<InboundMessage>;
}
