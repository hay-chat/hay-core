import jwt from "jsonwebtoken";
import type {
  PluginAPITokenPayload,
  EmailSendOptions,
  EmailResult,
} from "../../types/plugin-api.types";
import { emailService } from "../email.service";
import { emailDomainService, addressDomain } from "../email-domains.service";
import { createLogger } from "../../lib/logger";
import { config } from "../../config/env";
import {
  mintPluginApiToken,
  PLUGIN_API_TOKEN_AUDIENCE,
  PLUGIN_API_TOKEN_ISSUER,
} from "@server/lib/plugin-api-token";

const logger = createLogger("plugin-api");

/** Domain of the platform's configured sender (SMTP_FROM_EMAIL). */
function platformSenderDomain(): string {
  return config.smtp.from.email.split("@").pop()?.toLowerCase() ?? "";
}

/** Whether `address` may be used as a From address by a plugin. */
/**
 * Custom headers a plugin may set on outbound email: threading, our own
 * tracking headers and auto-responder hints. Anything else (From, To, Subject,
 * Return-Path, …) is dropped so a plugin cannot rewrite the envelope.
 */
const ALLOWED_HEADER_PATTERN = /^(in-reply-to|references|auto-submitted|x-[a-z0-9-]+)$/i;

export function allowedCustomHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const allowed = Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => ALLOWED_HEADER_PATTERN.test(name) && !/[\r\n]/.test(value),
    ),
  );
  return Object.keys(allowed).length ? allowed : undefined;
}

/** Whether `address` is on the organization's verified custom sending domain (D13-9). */
async function isVerifiedOrganizationAddress(
  organizationId: string,
  address: string,
): Promise<boolean> {
  const domain = addressDomain(address);
  if (!domain) return false;
  return (await emailDomainService.verifiedDomain(organizationId)) === domain;
}

export function isPlatformSenderAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@");
  return domain.length === 2 && domain[1] !== "" && domain[1] === platformSenderDomain();
}

/**
 * Plugin API Service
 *
 * Provides secure HTTP-based API for plugins running in separate processes
 * to access platform capabilities like email sending.
 *
 * Security model:
 * - JWT tokens scoped to specific plugin + organization
 * - Capability-based permissions (only declared capabilities allowed)
 * - Organization-scoped access control
 * - Rate limiting per plugin
 */
export class PluginAPIService {
  private static instance: PluginAPIService;

  private constructor() {}

  static getInstance(): PluginAPIService {
    if (!PluginAPIService.instance) {
      PluginAPIService.instance = new PluginAPIService();
    }
    return PluginAPIService.instance;
  }

  /**
   * Generate JWT token for plugin API access
   *
   * @param pluginId - Plugin identifier
   * @param organizationId - Organization identifier
   * @param capabilities - List of capabilities the plugin can access
   * @returns JWT token string
   */
  generateToken(pluginId: string, organizationId: string, capabilities: string[]): string {
    const token = mintPluginApiToken(organizationId, pluginId, capabilities);

    logger.debug({ pluginId, organizationId, capabilities }, "Generated token for plugin");

    return token;
  }

  /**
   * Validate JWT token and extract payload
   *
   * @param token - JWT token string
   * @returns Decoded token payload or null if invalid
   */
  validateToken(token: string): PluginAPITokenPayload | null {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: PLUGIN_API_TOKEN_ISSUER,
        audience: PLUGIN_API_TOKEN_AUDIENCE,
      }) as PluginAPITokenPayload;

      return decoded;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Token validation failed",
      );
      return null;
    }
  }

  /**
   * Check if plugin has required capability
   *
   * @param tokenPayload - Decoded JWT token payload
   * @param requiredCapability - Capability to check
   * @returns True if plugin has capability
   */
  hasCapability(tokenPayload: PluginAPITokenPayload, requiredCapability: string): boolean {
    return tokenPayload.capabilities.includes(requiredCapability);
  }

  /**
   * Send email using platform's email service
   * Requires "email" capability
   *
   * @param tokenPayload - Decoded JWT token payload
   * @param options - Email sending options
   * @returns Result of email sending operation
   */
  async sendEmail(
    tokenPayload: PluginAPITokenPayload,
    options: EmailSendOptions,
  ): Promise<EmailResult> {
    // Check capability
    if (!this.hasCapability(tokenPayload, "email")) {
      logger.error(
        {
          pluginId: tokenPayload.pluginId,
          organizationId: tokenPayload.organizationId,
        },
        "Plugin attempted to send email without capability",
      );

      return {
        success: false,
        error: "Plugin does not have email capability",
      };
    }

    try {
      logger.debug(
        {
          pluginId: tokenPayload.pluginId,
          organizationId: tokenPayload.organizationId,
          subject: options.subject,
          hasTo: !!options.to,
          hasText: !!options.text,
          hasHtml: !!options.html,
        },
        "Sending email via plugin",
      );

      // Validate required fields
      if (!options.to) {
        return {
          success: false,
          error: "Missing required field: to",
        };
      }

      // Plugins may pick the display name freely but can only send from the
      // platform's own domain or the organization's verified custom sending
      // domain (D13-9): anything else would let a plugin spoof a merchant's
      // or a third party's address through our relay.
      if (
        options.from &&
        !isPlatformSenderAddress(options.from.email) &&
        !(await isVerifiedOrganizationAddress(tokenPayload.organizationId, options.from.email))
      ) {
        return {
          success: false,
          error: `from.email must be on the platform sending domain (${platformSenderDomain()}) or the organization's verified sending domain`,
        };
      }

      // Initialize email service (idempotent - safe to call multiple times)
      await emailService.initialize();

      const result = await emailService.sendEmail({
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        from: options.from,
        replyTo: options.replyTo,
        headers: allowedCustomHeaders(options.headers),
        messageId: options.messageId,
        retry: options.retry,
        attachments: options.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.contentBase64, "base64"),
          contentType: attachment.contentType,
        })),
      });

      if (!result.success) {
        logger.warn(
          {
            pluginId: tokenPayload.pluginId,
            organizationId: tokenPayload.organizationId,
            error: result.error,
          },
          "Email send via plugin failed",
        );
        return { success: false, error: result.error ?? "Failed to send email" };
      }

      logger.debug(
        {
          pluginId: tokenPayload.pluginId,
          organizationId: tokenPayload.organizationId,
          messageId: result.messageId,
        },
        "Email sent successfully via plugin",
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error(
        {
          pluginId: tokenPayload.pluginId,
          organizationId: tokenPayload.organizationId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to send email via plugin",
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email",
      };
    }
  }
}
