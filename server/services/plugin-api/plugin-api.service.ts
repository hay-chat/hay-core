import jwt from "jsonwebtoken";
import type {
  PluginAPITokenPayload,
  EmailSendOptions,
  EmailResult,
} from "../../types/plugin-api.types";
import { emailService } from "../email.service";
import { debugLog } from "../../lib/debug-logger";
import { config } from "../../config/env";

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
  generateToken(
    pluginId: string,
    organizationId: string,
    capabilities: string[],
  ): string {
    const payload: PluginAPITokenPayload = {
      pluginId,
      organizationId,
      capabilities,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: "24h", // Token expires after 24 hours
      issuer: "hay-plugin-api",
      audience: "plugin",
    });

    debugLog("plugin-api", "Generated token for plugin", {
      pluginId,
      organizationId,
      capabilities,
    });

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
        issuer: "hay-plugin-api",
        audience: "plugin",
      }) as PluginAPITokenPayload;

      return decoded;
    } catch (error) {
      debugLog("plugin-api", "Token validation failed", {
        level: "warn",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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
  hasCapability(
    tokenPayload: PluginAPITokenPayload,
    requiredCapability: string,
  ): boolean {
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
      debugLog("plugin-api", "Plugin attempted to send email without capability", {
        level: "error",
        pluginId: tokenPayload.pluginId,
        organizationId: tokenPayload.organizationId,
      });

      return {
        success: false,
        error: "Plugin does not have email capability",
      };
    }

    try {
      debugLog("plugin-api", "Sending email via plugin", {
        pluginId: tokenPayload.pluginId,
        organizationId: tokenPayload.organizationId,
        subject: options.subject,
        hasTo: !!options.to,
        hasText: !!options.text,
        hasHtml: !!options.html,
      });

      // Validate required fields
      if (!options.to) {
        return {
          success: false,
          error: "Missing required field: to",
        };
      }

      // Initialize email service (idempotent - safe to call multiple times)
      await emailService.initialize();

      // Send email using the email service
      // Note: We validated that 'to' exists above, so it's safe to use non-null assertion
      const result = await emailService.sendEmail({
        to: options.to!,
        subject: options.subject,
        text: options.text,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
      });

      debugLog("plugin-api", "Email sent successfully via plugin", {
        pluginId: tokenPayload.pluginId,
        organizationId: tokenPayload.organizationId,
        messageId: result.messageId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      debugLog("plugin-api", "Failed to send email via plugin", {
        level: "error",
        pluginId: tokenPayload.pluginId,
        organizationId: tokenPayload.organizationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email",
      };
    }
  }
}
