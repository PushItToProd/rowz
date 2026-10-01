export interface EmailMessage {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** The part of a nodemailer transport this mailer uses. */
export interface MailTransport {
  sendMail(mail: {
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/** Delivers each message through a mail server. The body is sent as plain text. */
export function smtpMailer(transport: MailTransport, from: string): Mailer {
  return {
    async send({ to, cc, subject, body }) {
      await transport.sendMail({ from, to, cc, subject, text: body });
    },
  };
}

/**
 * Writes each message to the log and delivers nothing. It is the mailer when
 * no mail server is configured, so `SEND_EMAIL` can be tried without one.
 */
export function logMailer(log: (line: string) => void = console.log): Mailer {
  return {
    send(message) {
      log(JSON.stringify({ event: "email", ...message }));
      return Promise.resolve();
    },
  };
}
