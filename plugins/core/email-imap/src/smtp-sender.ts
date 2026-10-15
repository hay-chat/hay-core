import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { HayLogger } from "@hay/plugin-sdk/types";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  fromAddress: string;
  fromName?: string;
}

export interface SmtpSender {
  sendReply(options: {
    to: string;
    subject: string;
    content: string;
    inReplyTo?: string;
    references?: string[];
  }): Promise<{ messageId: string }>;
  getFromAddress(): string;
  verify(): Promise<void>;
}

export function createSmtpSender(config: SmtpConfig, logger: HayLogger): SmtpSender {
  const transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: config.secure },
  });

  const fromString = config.fromName
    ? `"${config.fromName}" <${config.fromAddress}>`
    : config.fromAddress;

  return {
    async sendReply(options) {
      const mailOptions: any = {
        from: fromString,
        to: options.to,
        subject: options.subject,
        text: options.content,
      };

      // Threading headers for proper email thread grouping
      if (options.inReplyTo) {
        mailOptions.inReplyTo = options.inReplyTo;
      }
      if (options.references && options.references.length > 0) {
        mailOptions.references = options.references.join(" ");
      }

      const info = await transporter.sendMail(mailOptions);

      logger.info("SMTP email sent", {
        to: options.to,
        subject: options.subject,
        messageId: info.messageId,
      });

      return { messageId: info.messageId };
    },

    getFromAddress() {
      return config.fromAddress;
    },

    async verify() {
      await transporter.verify();
    },
  };
}
