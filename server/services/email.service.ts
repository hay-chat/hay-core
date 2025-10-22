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
        console.warn("SMTP is disabled. Emails will not be sent.");
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize email service:", error);
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
      console.log("SMTP connection verified successfully");
    } catch (error) {
      console.error("SMTP connection verification failed:", error);
      throw error;
    }
  }

  /**
   * Send an email
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    console.log("📧 [EmailService] sendEmail called with:", {
      to: options.to,
      subject: options.subject,
      hasFromProperty: "from" in options,
      fromValue: options.from,
      smtpEnabled: config.smtp.enabled,
    });

    if (!config.smtp.enabled) {
      console.log("⚠️ [EmailService] SMTP disabled. Would send email to:", options.to);
      console.log("📝 [EmailService] Email subject:", options.subject);
      console.log(
        "📄 [EmailService] Email preview (first 200 chars):",
        options.html?.substring(0, 200),
      );
      return {
        success: true,
        messageId: `mock-${uuidv4()}`,
        response: "Email logged (SMTP disabled)",
      };
    }

    if (!this.transporter) {
      console.error("❌ [EmailService] Email service not initialized");
      throw new Error("Email service not initialized");
    }

    // Build the 'from' address with fallback
    const fromAddress = options.from
      ? `"${options.from.name || options.from.email}" <${options.from.email}>`
      : `"${config.smtp.from.name}" <${config.smtp.from.email}>`;

    console.log("🔧 [EmailService] Building from address:", {
      hasOptionsFrom: !!options.from,
      optionsFrom: options.from,
      configFromName: config.smtp.from.name,
      configFromEmail: config.smtp.from.email,
      finalFromAddress: fromAddress,
    });

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
      console.log("📤 [EmailService] Sending email via SMTP with mailOptions:", {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        hasHtml: !!mailOptions.html,
        htmlLength: mailOptions.html?.length,
        hasText: !!mailOptions.text,
      });
      const info = await this.transporter.sendMail(mailOptions);
      console.log("✅ [EmailService] Email sent successfully!");
      console.log("📬 [EmailService] SMTP Response:", {
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
        pending: info.pending,
        envelope: info.envelope,
      });
      console.log("📧 [EmailService] Email details:", {
        to: options.to,
        from: mailOptions.from,
        subject: options.subject,
      });
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [EmailService] Failed to send email:", {
        error: errorMessage,
        to: options.to,
        subject: options.subject,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Add to retry queue
      const queueItem = this.addToQueue(options);
      console.log("🔄 [EmailService] Added to retry queue:", queueItem.id);

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
    console.log("📝 [EmailService] sendTemplateEmail called:", {
      template: options.template,
      to: options.to,
      subject: options.subject,
      variablesProvided: !!options.variables,
      variableKeys: options.variables ? Object.keys(options.variables) : [],
    });

    try {
      console.log("🎨 [EmailService] Rendering template:", options.template);

      // Inject default variables for all templates
      const defaultVariables = {
        logoUrl: `${getCdnUrl()}/logos/logo.png`,
        websiteUrl: getDashboardUrl(),
        currentYear: new Date().getFullYear().toString(),
      };

      // Merge with provided variables (provided variables take precedence)
      const mergedVariables = {
        ...defaultVariables,
        ...(options.variables || {}),
      };

      const { html, text } = await this.templateService.render({
        template: options.template,
        variables: mergedVariables,
        useCache: true,
        stripComments: true,
        minify: true,
      });
      console.log("✅ [EmailService] Template rendered successfully");

      // Get template to extract subject
      const template = this.templateService.getTemplate(options.template);
      let subject = options.subject;

      if (!subject && template) {
        console.log("📋 [EmailService] Using template subject:", template.subject);
        // Replace variables in subject
        subject = template.subject;
        if (options.variables) {
          for (const [key, value] of Object.entries(options.variables)) {
            subject = subject.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), String(value));
          }
        }
      }

      // Build email options, excluding undefined 'from' to allow default fallback
      const emailOptions: EmailOptions = {
        to: options.to,
        subject: subject || "No Subject",
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

      console.log("📨 [EmailService] Built emailOptions:", {
        to: emailOptions.to,
        subject: emailOptions.subject,
        hasFrom: !!emailOptions.from,
        from: emailOptions.from,
        hasHtml: !!emailOptions.html,
        htmlLength: emailOptions.html?.length,
        hasText: !!emailOptions.text,
      });

      return await this.sendEmail(emailOptions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ [EmailService] Template email failed:", {
        error: errorMessage,
        template: options.template,
        stack: error instanceof Error ? error.stack : undefined,
      });
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
