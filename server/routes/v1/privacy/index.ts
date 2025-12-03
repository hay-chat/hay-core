import { t } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure } from "@server/trpc/middleware/auth";
import { privacyService } from "@server/services/privacy.service";
import { rateLimitService } from "@server/services/rate-limit.service";

/**
 * Privacy Router
 * Handles GDPR Data Subject Access Requests (DSAR)
 * All endpoints are public (no authentication required)
 * Rate limiting applied to prevent abuse
 */

// Rate limit configurations
const RATE_LIMITS = {
  IP_REQUESTS_PER_HOUR: 10,
  EMAIL_REQUESTS_PER_DAY: 3,
  COMBINED_REQUESTS_PER_DAY: 2,
  IP_WINDOW_SECONDS: 3600, // 1 hour
  EMAIL_WINDOW_SECONDS: 86400, // 24 hours
  COMBINED_WINDOW_SECONDS: 86400, // 24 hours
};

/**
 * Format time remaining in a user-friendly way
 */
function formatTimeRemaining(resetAt: Date): string {
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  const diffMinutes = Math.ceil(diffMs / 60000);

  if (diffMinutes < 1) {
    return "less than a minute";
  } else if (diffMinutes === 1) {
    return "1 minute";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minutes`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    const remainingMinutes = diffMinutes % 60;
    if (remainingMinutes === 0) {
      return hours === 1 ? "1 hour" : `${hours} hours`;
    } else {
      return `${hours} hour${hours > 1 ? 's' : ''} and ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
    }
  }
}

/**
 * Check rate limits for privacy requests
 * Applies IP, email, and combined throttling
 * Uses fail-closed policy to prevent abuse during Redis outages
 */
async function checkPrivacyRateLimits(
  email: string,
  ipAddress: string,
): Promise<void> {
  const FAIL_CLOSED = true; // Privacy endpoints fail closed for security

  try {
    // Check IP rate limit (5 requests per hour)
    const ipLimit = await rateLimitService.checkIpRateLimit(
      ipAddress,
      RATE_LIMITS.IP_REQUESTS_PER_HOUR,
      RATE_LIMITS.IP_WINDOW_SECONDS,
      FAIL_CLOSED,
    );

    if (ipLimit.limited) {
      const timeRemaining = formatTimeRemaining(ipLimit.resetAt);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests from this IP address. Please try again in ${timeRemaining}.`,
      });
    }

    // Check email rate limit (3 requests per day)
    const emailLimit = await rateLimitService.checkEmailRateLimit(
      email,
      RATE_LIMITS.EMAIL_REQUESTS_PER_DAY,
      RATE_LIMITS.EMAIL_WINDOW_SECONDS,
      FAIL_CLOSED,
    );

    if (emailLimit.limited) {
      const timeRemaining = formatTimeRemaining(emailLimit.resetAt);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests for this email address. Please try again in ${timeRemaining}.`,
      });
    }

    // Check combined IP+email rate limit (2 requests per day)
    const combinedLimit = await rateLimitService.checkCombinedRateLimit(
      ipAddress,
      email,
      RATE_LIMITS.COMBINED_REQUESTS_PER_DAY,
      RATE_LIMITS.COMBINED_WINDOW_SECONDS,
      FAIL_CLOSED,
    );

    if (combinedLimit.limited) {
      const timeRemaining = formatTimeRemaining(combinedLimit.resetAt);
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests. Please try again in ${timeRemaining}.`,
      });
    }
  } catch (error) {
    // If rate limiting service throws an error (Redis unavailable), convert to TRPC error
    if (error instanceof Error && error.message.includes("Rate limiting service")) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Privacy request system is temporarily unavailable. Please try again later.",
      });
    }
    throw error;
  }
}

export const privacyRouter = t.router({
  /**
   * Request a data export
   * Sends verification email to the provided address
   */
  requestExport: publicProcedure
    .input(
      z.object({
        email: z.string().email("Please provide a valid email address"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.ipAddress || "unknown";

      // Check rate limits
      await checkPrivacyRateLimits(input.email, ipAddress);

      try {
        const result = await privacyService.requestExport(
          input.email,
          ipAddress,
          ctx.userAgent,
        );

        return {
          success: true,
          requestId: result.requestId,
          message:
            "A verification email has been sent. Please check your inbox and click the link to confirm your data export request.",
          expiresAt: result.expiresAt,
        };
      } catch (error) {
        console.error("[Privacy] Export request failed:", error);
        const message = error instanceof Error ? error.message : "Failed to process export request. Please try again later.";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Confirm data export with verification token
   * Creates a background job to generate the export
   */
  confirmExport: publicProcedure
    .input(
      z.object({
        token: z.string().min(1, "Verification token is required"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await privacyService.confirmExport(input.token);

        return {
          success: true,
          requestId: result.requestId,
          jobId: result.jobId,
          message:
            "Your data export request has been confirmed. We are processing your data and will send you an email when it's ready to download.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Request data deletion
   * Sends verification email to the provided address
   */
  requestDeletion: publicProcedure
    .input(
      z.object({
        email: z.string().email("Please provide a valid email address"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.ipAddress || "unknown";

      // Check rate limits
      await checkPrivacyRateLimits(input.email, ipAddress);

      try {
        const result = await privacyService.requestDeletion(
          input.email,
          ipAddress,
          ctx.userAgent,
        );

        return {
          success: true,
          requestId: result.requestId,
          message:
            "A verification email has been sent. Please check your inbox and click the link to confirm your data deletion request. This action cannot be undone.",
          expiresAt: result.expiresAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Confirm data deletion with verification token
   * Creates a background job to delete the data
   */
  confirmDeletion: publicProcedure
    .input(
      z.object({
        token: z.string().min(1, "Verification token is required"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await privacyService.confirmDeletion(input.token);

        return {
          success: true,
          requestId: result.requestId,
          jobId: result.jobId,
          message:
            "Your data deletion request has been confirmed. We are processing your request and will send you a confirmation email when complete.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get status of a privacy request
   * Returns current status and job information
   */
  getStatus: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid("Invalid request ID"),
      }),
    )
    .query(async ({ input }) => {
      try {
        const status = await privacyService.getStatus(input.requestId);

        return {
          success: true,
          ...status,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "NOT_FOUND",
          message,
        });
      }
    }),

  /**
   * Cancel a pending privacy request
   * Requires verification token from the original request email
   */
  cancelRequest: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid("Invalid request ID"),
        token: z.string().min(1, "Verification token is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.ipAddress || "unknown";

      try {
        await privacyService.cancelRequest(input.requestId, input.token, ipAddress);

        return {
          success: true,
          message: "Privacy request has been cancelled successfully.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Download export data
   * Requires valid request ID and download token
   * Supports both JSON (legacy) and ZIP (new) formats
   */
  downloadExport: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid("Invalid request ID"),
        downloadToken: z.string().min(1, "Download token is required"),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const ipAddress = ctx.ipAddress || "unknown";

        const result = await privacyService.downloadExport(
          input.requestId,
          input.downloadToken,
          ipAddress,
        );

        // Handle ZIP format - read file and return as base64
        if (result.isZip && result.filePath) {
          const fs = await import("fs/promises");
          const fileBuffer = await fs.readFile(result.filePath);
          const base64Data = fileBuffer.toString("base64");

          return {
            success: true,
            data: null,
            fileName: result.fileName,
            isZip: true,
            base64Data,
          };
        }

        // Legacy JSON format
        return {
          success: true,
          data: result.data,
          fileName: result.fileName,
          isZip: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),
});
