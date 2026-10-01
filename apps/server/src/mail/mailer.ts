export interface EmailMessage {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Writes each message to the log and delivers nothing. This is the only
 * mailer for now, so `SEND_EMAIL` can be used end to end without a mail server.
 */
export function logMailer(log: (line: string) => void = console.log): Mailer {
  return {
    send(message) {
      log(JSON.stringify({ event: "email", ...message }));
      return Promise.resolve();
    },
  };
}
