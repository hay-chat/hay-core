import { emailService } from "@server/services/email.service";
import type {
  EmailAPI,
  EmailSendOptions,
  EmailResult,
} from "@server/types/plugin-api.types";

/**
 * Email API implementation for Plugin API
 *
 * Provides a controlled interface for plugins to send emails via the platform's
 * email service. Handles recipient parsing from plugin config and delegates to
 * the email service.
 *
 * Usage in manifest.json:
 * ```json
 * {
 *   "permissions": {
 *     "api": ["email"]
 *   }
 * }
 * ```
 *
 * Security features:
 * - Plugins must declare "email" in permissions.api to access this API
 * - Plugins can only send emails to configured recipients (unless overridden)
 * - All emails are logged with plugin ID for auditing
 * - Uses platform's email service with rate limiting and queue management
 *
 * TODO: [PLUGIN-API] Add rate limiting per plugin
 * TODO: [PLUGIN-API] Add email send quota tracking
 * TODO: [PLUGIN-API] Add email template support for plugins
 */
export class EmailAPIImpl implements EmailAPI {
  private pluginId: string;
  private organizationId: string;
  private defaultRecipients: string[];

  constructor(
    pluginId: string,
    organizationId: string,
    config: Record<string, any>
  ) {
    this.pluginId = pluginId;
    this.organizationId = organizationId;

    // Parse recipients from plugin config
    const recipientsStr = config.recipients || "";
    this.defaultRecipients = recipientsStr
      .split(",")
      .map((email: string) => email.trim())
      .filter((email: string) => email.length > 0);
  }

  async send(options: EmailSendOptions): Promise<EmailResult> {
    try {
      // Use provided recipients or fall back to config
      const recipients = options.to || this.defaultRecipients;

      // Validation
      if (!recipients || recipients.length === 0) {
        throw new Error("No recipients specified in options or plugin config");
      }

      if (!options.subject) {
        throw new Error("Email subject is required");
      }

      if (!options.text && !options.html) {
        throw new Error("Email must have either text or html body");
      }

      // Send via platform email service
      const result = await emailService.sendEmail({
        to: recipients,
        subject: options.subject,
        text: options.text,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
      });

      // Log successful send for auditing
      console.log(
        `[Plugin:${this.pluginId}] Email sent to ${Array.isArray(recipients) ? recipients.join(", ") : recipients}`
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      // Log error for debugging
      console.error(`[Plugin:${this.pluginId}] Failed to send email:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email",
      };
    }
  }

  /**
   * Get the default recipients configured for this plugin
   * Useful for plugins that want to show/validate recipients before sending
   */
  getDefaultRecipients(): string[] {
    return [...this.defaultRecipients];
  }
}
