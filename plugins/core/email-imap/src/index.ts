import { defineHayPlugin } from "@hay/plugin-sdk";
import { createImapPoller, type ImapPoller } from "./imap-poller.js";
import { createSmtpSender, type SmtpSender } from "./smtp-sender.js";
import { deliverHandler } from "./deliver.js";

/**
 * Email Channel Plugin (IMAP/SMTP)
 *
 * Enables email as a communication channel by polling an IMAP mailbox
 * for incoming messages and sending replies via SMTP.
 *
 * Inbound:  IMAP polling (configurable interval) → messages.receive API
 * Outbound: Channel Delivery Service → POST /deliver → SMTP send
 */
export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  // Shared state set during onStart, accessed by route handlers via closure
  let imapPoller: ImapPoller | null = null;
  let smtpSender: SmtpSender | null = null;

  return {
    name: "Email (IMAP)",

    onInitialize(ctx) {
      const { register } = ctx;

      logger.info("Initializing Email IMAP plugin");

      // IMAP configuration
      register.config({
        imapHost: {
          type: "string",
          label: "IMAP Host",
          description: "IMAP server hostname (e.g., imap.gmail.com)",
          required: true,
          encrypted: false,
        },
        imapPort: {
          type: "string",
          label: "IMAP Port",
          description: "IMAP server port (993 for TLS, 143 for STARTTLS)",
          required: true,
          encrypted: false,
        },
        imapUser: {
          type: "string",
          label: "IMAP Username",
          description: "IMAP login username (usually your email address)",
          required: true,
          encrypted: false,
        },
        imapPassword: {
          type: "string",
          label: "IMAP Password",
          description: "IMAP login password or app-specific password",
          required: true,
          encrypted: true,
        },
        imapTls: {
          type: "string",
          label: "IMAP Use TLS",
          description: 'Use TLS connection (default: "true")',
          required: false,
          encrypted: false,
        },
        imapMailbox: {
          type: "string",
          label: "Mailbox Folder",
          description: "IMAP folder to monitor (default: INBOX)",
          required: false,
          encrypted: false,
        },
        // SMTP configuration
        smtpHost: {
          type: "string",
          label: "SMTP Host",
          description: "SMTP server hostname (e.g., smtp.gmail.com)",
          required: true,
          encrypted: false,
        },
        smtpPort: {
          type: "string",
          label: "SMTP Port",
          description: "SMTP server port (465 for SSL, 587 for STARTTLS)",
          required: true,
          encrypted: false,
        },
        smtpUser: {
          type: "string",
          label: "SMTP Username",
          description: "SMTP login username",
          required: true,
          encrypted: false,
        },
        smtpPassword: {
          type: "string",
          label: "SMTP Password",
          description: "SMTP login password or app-specific password",
          required: true,
          encrypted: true,
        },
        // Sending identity
        fromAddress: {
          type: "string",
          label: "From Address",
          description: "Email address used as the sender (e.g., support@company.com)",
          required: true,
          encrypted: false,
        },
        fromName: {
          type: "string",
          label: "From Name",
          description: "Display name for outbound emails (e.g., Company Support)",
          required: false,
          encrypted: false,
        },
        // Polling configuration
        pollingIntervalSeconds: {
          type: "string",
          label: "Polling Interval (seconds)",
          description: "How often to check for new emails (default: 60)",
          required: false,
          encrypted: false,
        },
      });

      // Auth method — uses imapPassword as the credential identifier
      register.auth.apiKey({
        id: "imapPassword",
        label: "IMAP Password",
        configField: "imapPassword",
      });

      // Outbound: Channel Delivery Service posts here to send replies
      register.route("POST", "/deliver", async (req, res) => {
        await deliverHandler(req, res, {
          getSmtpSender: () => smtpSender,
          logger,
        });
      });

      logger.info("Email IMAP plugin config and routes registered");
    },

    async onValidateAuth(ctx) {
      ctx.logger.info("Validating IMAP/SMTP credentials");

      // Test IMAP connection
      const imapHost = ctx.config.get<string>("imapHost");
      const imapPort = parseInt(ctx.config.get<string>("imapPort") || "993", 10);
      const imapUser = ctx.config.get<string>("imapUser");
      const imapPassword = ctx.config.get<string>("imapPassword");
      const imapTls = ctx.config.getOptional<string>("imapTls") !== "false";

      const { ImapFlow } = await import("imapflow");
      const testClient = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: imapTls,
        auth: { user: imapUser, pass: imapPassword },
        logger: false,
      });

      try {
        await testClient.connect();
        await testClient.logout();
        ctx.logger.info("IMAP connection validated");
      } catch (error: any) {
        throw new Error(`IMAP connection failed: ${error.message}`);
      }

      // Test SMTP connection
      const smtpHost = ctx.config.get<string>("smtpHost");
      const smtpPort = parseInt(ctx.config.get<string>("smtpPort") || "587", 10);
      const smtpUser = ctx.config.get<string>("smtpUser");
      const smtpPassword = ctx.config.get<string>("smtpPassword");

      const testSender = createSmtpSender(
        {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          password: smtpPassword,
          secure: true,
          fromAddress: ctx.config.get<string>("fromAddress"),
        },
        ctx.logger,
      );

      try {
        await testSender.verify();
        ctx.logger.info("SMTP connection validated");
      } catch (error: any) {
        throw new Error(`SMTP connection failed: ${error.message}`);
      }

      ctx.logger.info("IMAP and SMTP credentials validated successfully");
      return true;
    },

    async onStart(ctx) {
      ctx.logger.info("Starting Email IMAP plugin", { orgId: ctx.org.id });

      const imapHost = ctx.config.getOptional<string>("imapHost");
      const imapPassword = ctx.config.getOptional<string>("imapPassword");

      if (!imapHost || !imapPassword) {
        ctx.logger.info("IMAP credentials not configured — plugin enabled but not polling");
        return;
      }

      // Initialize SMTP sender for outbound replies
      smtpSender = createSmtpSender(
        {
          host: ctx.config.get<string>("smtpHost"),
          port: parseInt(ctx.config.get<string>("smtpPort") || "587", 10),
          user: ctx.config.get<string>("smtpUser"),
          password: ctx.config.get<string>("smtpPassword"),
          secure: ctx.config.getOptional<string>("imapTls") !== "false",
          fromAddress: ctx.config.get<string>("fromAddress"),
          fromName: ctx.config.getOptional<string>("fromName") || undefined,
        },
        logger,
      );

      // Initialize and start IMAP poller for inbound messages
      const pollingInterval =
        parseInt(ctx.config.getOptional<string>("pollingIntervalSeconds") || "60", 10) * 1000;

      imapPoller = createImapPoller(
        {
          host: ctx.config.get<string>("imapHost"),
          port: parseInt(ctx.config.get<string>("imapPort") || "993", 10),
          user: ctx.config.get<string>("imapUser"),
          password: ctx.config.get<string>("imapPassword"),
          secure: ctx.config.getOptional<string>("imapTls") !== "false",
          mailbox: ctx.config.getOptional<string>("imapMailbox") || "INBOX",
          pollingIntervalMs: pollingInterval,
        },
        logger,
      );

      await imapPoller.start();

      ctx.logger.info("Email IMAP plugin started", {
        orgId: ctx.org.id,
        pollingIntervalMs: pollingInterval,
        mailbox: ctx.config.getOptional<string>("imapMailbox") || "INBOX",
      });
    },

    async onConfigUpdate(ctx) {
      ctx.logger.info("Email IMAP config updated — will take effect on next restart");
    },

    async onDisable(ctx) {
      ctx.logger.info("Email IMAP plugin disabled", { orgId: ctx.org.id });

      if (imapPoller) {
        await imapPoller.stop();
        imapPoller = null;
      }
      smtpSender = null;
    },
  };
});
