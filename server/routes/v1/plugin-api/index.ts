import { Router, Request, Response, NextFunction } from "express";
import { PluginAPIService } from "../../../services/plugin-api/plugin-api.service";
import type {
  PluginAPITokenPayload,
  PluginAPIHttpResponse,
  SendEmailHttpRequest,
  SendEmailHttpResponse,
} from "../../../types/plugin-api.types";
import { debugLog } from "../../../lib/debug-logger";

const router = Router();
const pluginAPIService = PluginAPIService.getInstance();

/**
 * Authentication middleware for Plugin API
 * Validates JWT token and attaches decoded payload to request
 */
interface AuthenticatedRequest extends Request {
  pluginAuth?: PluginAPITokenPayload;
}

const authenticatePlugin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Missing or invalid authorization header",
    } as PluginAPIHttpResponse);
    return;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  const payload = pluginAPIService.validateToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: "Invalid or expired token",
    } as PluginAPIHttpResponse);
    return;
  }

  req.pluginAuth = payload;
  next();
};

/**
 * POST /v1/plugin-api/send-email
 * Send email using platform's email service
 *
 * Requires:
 * - Valid JWT token in Authorization header
 * - Plugin must have "email" capability
 */
router.post(
  "/send-email",
  authenticatePlugin,
  async (req: AuthenticatedRequest, res: Response) => {
    const pluginAuth = req.pluginAuth!; // Safe because authenticatePlugin middleware guarantees this
    const emailRequest = req.body as SendEmailHttpRequest;

    // Validate request body
    if (!emailRequest.subject) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: subject",
      } as PluginAPIHttpResponse);
    }

    if (!emailRequest.body && !emailRequest.html) {
      return res.status(400).json({
        success: false,
        error: "Must provide either body (text) or html",
      } as PluginAPIHttpResponse);
    }

    try {
      debugLog("plugin-api", "Received send-email request", {
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        subject: emailRequest.subject,
        hasTo: !!emailRequest.to,
        hasText: !!emailRequest.body,
        hasHtml: !!emailRequest.html,
      });

      // Call service to send email
      const result = await pluginAPIService.sendEmail(pluginAuth, {
        to: emailRequest.to,
        subject: emailRequest.subject,
        text: emailRequest.body,
        html: emailRequest.html,
        cc: emailRequest.cc,
        bcc: emailRequest.bcc,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error || "Failed to send email",
        } as PluginAPIHttpResponse);
      }

      return res.status(200).json({
        success: true,
        data: {
          messageId: result.messageId,
          recipients: Array.isArray(emailRequest.to)
            ? emailRequest.to
            : emailRequest.to
              ? [emailRequest.to]
              : [],
        } as SendEmailHttpResponse,
      } as PluginAPIHttpResponse<SendEmailHttpResponse>);
    } catch (error) {
      debugLog("plugin-api", "Error in send-email endpoint", {
        level: "error",
        pluginId: pluginAuth.pluginId,
        organizationId: pluginAuth.organizationId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      } as PluginAPIHttpResponse);
    }
  },
);

/**
 * GET /v1/plugin-api/health
 * Health check endpoint for plugins to verify API connectivity
 */
router.get(
  "/health",
  authenticatePlugin,
  (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        pluginId: req.pluginAuth!.pluginId,
        organizationId: req.pluginAuth!.organizationId,
        capabilities: req.pluginAuth!.capabilities,
      },
    } as PluginAPIHttpResponse);
  },
);

export default router;
