import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config, getCdnUrl, getDashboardUrl } from "../config/env";
import { TemplateService } from "./template.service";
import type {
  EmailOptions,
  EmailTemplateOptions,
  EmailResult,
  EmailQueueItem,
  EmailStatus,
} from "../types/email.types";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "@server/lib/logger";
import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import { DEFAULT_LANGUAGE } from "@server/types/language.types";

const logger = createLogger("email");

export class EmailService {
  private transporter: Transporter | null = null;
  private templateService: TemplateService;
  private emailQueue: Map<string, EmailQueueItem> = new Map();
  private retryTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.templateService = new TemplateService();
  }

  /**
   * Initialize the email service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize template service
      await this.templateService.initialize();

      // Create transporter if SMTP is enabled
      if (config.smtp.enabled) {
        this.transporter = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: {
            user: config.smtp.auth.user,
            pass: config.smtp.auth.pass,
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          rateLimit: 10, // 10 messages per second
        });

        // Verify connection
        await this.verifyConnection();

        // Start retry queue processor
        this.startRetryProcessor();
      } else {
        logger.warn("SMTP is disabled. Emails will not be sent.");
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize email service");
      throw new Error("Email service initialization failed");
    }
  }

  /**
   * Verify SMTP connection
   */
  private async verifyConnection(): Promise<void> {
    if (!this.transporter) {
      throw new Error("Transporter not initialized");
    }

    try {
      await this.transporter.verify();
      logger.info("SMTP connection verified successfully");
    } catch (error) {
      logger.error({ err: error }, "SMTP connection verification failed");
      throw error;
    }
  }

  /**
   * Send an email
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    logger.debug({
      to: options.to,
      subject: options.subject,
      hasFromProperty: "from" in options,
      smtpEnabled: config.smtp.enabled,
    }, "sendEmail called");

    if (!config.smtp.enabled) {
      logger.debug({
        to: options.to,
        subject: options.subject,
        preview: options.html?.substring(0, 200),
      }, "SMTP disabled, email not sent");
      return {
        success: true,
        messageId: `mock-${uuidv4()}`,
        response: "Email logged (SMTP disabled)",
      };
    }

    if (!this.transporter) {
      logger.error("Email service not initialized");
      throw new Error("Email service not initialized");
    }

    // Build the 'from' address with fallback
    const fromAddress = options.from
      ? `"${options.from.name || options.from.email}" <${options.from.email}>`
      : `"${config.smtp.from.name}" <${config.smtp.from.email}>`;

    logger.debug({
      hasOptionsFrom: !!options.from,
      finalFromAddress: fromAddress,
    }, "Building from address");

    const mailOptions = {
      from: fromAddress,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(", ") : options.cc) : undefined,
      bcc: options.bcc
        ? Array.isArray(options.bcc)
          ? options.bcc.join(", ")
          : options.bcc
        : undefined,
      replyTo: options.replyTo,
      attachments: options.attachments,
      headers: options.headers,
      priority: options.priority,
    };

    try {
      logger.debug({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
      }, "Sending email via SMTP");
      const info = await this.transporter.sendMail(mailOptions);
      logger.info({
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
      }, "Email sent successfully");
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error({
        err: error,
        to: options.to,
        subject: options.subject,
      }, "Failed to send email");

      // Add to retry queue
      const queueItem = this.addToQueue(options);
      logger.debug({ queueItemId: queueItem.id }, "Added to retry queue");

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send an email using a template
   */
  async sendTemplateEmail(options: EmailTemplateOptions): Promise<EmailResult> {
    logger.debug({
      template: options.template,
      to: options.to,
      subject: options.subject,
    }, "sendTemplateEmail called");

    try {
      logger.debug({ template: options.template }, "Rendering template");

      // Inject default variables for all templates
      const defaultVariables = {
        logoUrl: `${getCdnUrl()}/logos/logo.png`,
        websiteUrl: getDashboardUrl(),
        currentYear: new Date().getFullYear().toString(),
      };

      // Merge with provided variables (provided variables take precedence)
      const mergedVariables: Record<string, string> = {
        ...defaultVariables,
        ...(options.variables || {}),
      };

      let { html, text } = await this.templateService.render({
        template: options.template,
        variables: mergedVariables,
        locale: options.locale,
        useCache: true,
        stripComments: true,
        minify: true,
      });
      logger.debug("Template rendered successfully");

      // Resolve subject: explicit > translated > template comment fallback
      let subject = options.subject;

      if (!subject) {
        // Try translated subject first, then fall back to template comment
        subject = this.templateService.getTranslatedSubject(options.template, options.locale) ?? undefined;
        if (subject) {
          logger.debug({ subject, locale: options.locale }, "Using translated subject");
          // Replace variables in translated subject
          if (options.variables) {
            for (const [key, value] of Object.entries(options.variables)) {
              subject = subject!.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), String(value));
            }
          }
        }
      }

      // Re-render with emailTitle and emailPreview now that subject is resolved
      // These are used in base.mjml <mj-title> and <mj-preview> tags
      const finalSubject = subject || "No Subject";
      if (!mergedVariables.emailTitle || !mergedVariables.emailPreview) {
        mergedVariables.emailTitle = mergedVariables.emailTitle || finalSubject;
        mergedVariables.emailPreview = mergedVariables.emailPreview || finalSubject;
        mergedVariables.recipientEmail = mergedVariables.recipientEmail || options.to;

        const rerendered = await this.templateService.render({
          template: options.template,
          variables: mergedVariables,
          locale: options.locale,
          useCache: true,
          stripComments: true,
          minify: true,
        });
        html = rerendered.html;
        text = rerendered.text;
      }

      // Build email options, excluding undefined 'from' to allow default fallback
      const emailOptions: EmailOptions = {
        to: options.to,
        subject: finalSubject,
        html,
        text,
        ...(options.from && { from: options.from }),
        ...(options.cc && { cc: options.cc }),
        ...(options.bcc && { bcc: options.bcc }),
        ...(options.replyTo && { replyTo: options.replyTo }),
        ...(options.attachments && { attachments: options.attachments }),
        ...(options.headers && { headers: options.headers }),
        ...(options.priority && { priority: options.priority }),
      };

      logger.debug({
        to: emailOptions.to,
        subject: emailOptions.subject,
        hasFrom: !!emailOptions.from,
      }, "Built emailOptions");

      return await this.sendEmail(emailOptions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error({
        err: error,
        template: options.template,
      }, "Template email failed");
      return {
        success: false,
        error: `Template email failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Add email to retry queue
   */
  private addToQueue(options: EmailOptions): EmailQueueItem {
    const id = uuidv4();
    const queueItem: EmailQueueItem = {
      id,
      options,
      status: "retry" as EmailStatus,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };

    this.emailQueue.set(id, queueItem);
    return queueItem;
  }

  /**
   * Start retry processor
   */
  private startRetryProcessor(): void {
    if (this.retryTimeout) {
      return;
    }

    const processRetries = async () => {
      for (const [id, item] of this.emailQueue.entries()) {
        if (item.status === "retry" && item.attempts < item.maxAttempts) {
          item.attempts++;

          try {
            const result = await this.sendEmail(item.options);
            if (result.success) {
              item.status = "sent" as EmailStatus;
              item.sentAt = new Date();
              this.emailQueue.delete(id);
            } else {
              item.error = result.error;
              if (item.attempts >= item.maxAttempts) {
                item.status = "failed" as EmailStatus;
              }
            }
          } catch (error) {
            item.error = error instanceof Error ? error.message : "Unknown error";
            if (item.attempts >= item.maxAttempts) {
              item.status = "failed" as EmailStatus;
            }
          }
        } else if (item.status === "failed") {
          // Keep failed emails for 24 hours for debugging
          const hoursSinceCreation = (Date.now() - item.createdAt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceCreation > 24) {
            this.emailQueue.delete(id);
          }
        }
      }

      // Schedule next retry check
      this.retryTimeout = setTimeout(processRetries, 60000); // Check every minute
    };

    // Start the processor
    processRetries();
  }

  /**
   * Stop retry processor
   */
  private stopRetryProcessor(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    pending: number;
    retry: number;
    failed: number;
    items: EmailQueueItem[];
  } {
    const items = Array.from(this.emailQueue.values());
    return {
      pending: items.filter((i) => i.status === "pending").length,
      retry: items.filter((i) => i.status === "retry").length,
      failed: items.filter((i) => i.status === "failed").length,
      items,
    };
  }

  /**
   * Clear failed emails from queue
   */
  clearFailedEmails(): void {
    for (const [id, item] of this.emailQueue.entries()) {
      if (item.status === "failed") {
        this.emailQueue.delete(id);
      }
    }
  }

  /**
   * Retry a specific failed email
   */
  retryEmail(emailId: string): boolean {
    const item = this.emailQueue.get(emailId);
    if (item && item.status === "failed") {
      item.status = "retry" as EmailStatus;
      item.attempts = 0;
      return true;
    }
    return false;
  }

  /**
   * Get available templates
   */
  getAvailableTemplates() {
    return this.templateService.getTemplates();
  }

  /**
   * Reload templates
   */
  async reloadTemplates(): Promise<void> {
    await this.templateService.reloadTemplates();
  }

  /**
   * Cleanup and close connections
   */
  async cleanup(): Promise<void> {
    this.stopRetryProcessor();
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
    this.isInitialized = false;
  }
}

// Export singleton instance
export const emailService = new EmailService();

/**
 * Resolve the organization's default language for email localization.
 * Falls back to English if the organization is not found or has no language set.
 */
export async function getOrganizationLocale(organizationId?: string | null): Promise<string> {
  if (!organizationId) return DEFAULT_LANGUAGE;
  try {
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({
      where: { id: organizationId },
      select: ["id", "defaultLanguage"],
    });
    return org?.defaultLanguage || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
