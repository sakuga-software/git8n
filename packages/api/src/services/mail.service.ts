import { createTransport, type Transporter } from 'nodemailer';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transport: Transporter | undefined;

/** The mails sent while no SMTP server is set, outside production. The tests read them. */
export const sentInDevelopment: Mail[] = [];

/**
 * Sends a mail through `SMTP_URL`.
 *
 * Without `SMTP_URL`, outside production, the API writes the mail in its log,
 * so a developer can open the link. In production, it writes only that no mail
 * left: a magic link in a log gives a session to whoever reads the log.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.SMTP_URL) {
    if (env.DEV) {
      sentInDevelopment.push(mail);
      logger.info(`No SMTP_URL: the mail to ${mail.to} is not sent.\n${mail.subject}\n\n${mail.text}`);
    } else {
      logger.error(`No SMTP_URL: the mail to ${mail.to} is not sent.`);
    }

    return;
  }

  transport ??= createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}
