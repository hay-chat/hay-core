import { t, authenticatedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { privacyService } from "@server/services/privacy.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import { AppDataSource } from "@server/database/data-source";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";

/**
 * Customer Privacy Router
 * Handles GDPR Data Subject Access Requests (DSAR) for end customers (B2B2C)
 * Organizations can manage privacy requests for their customers
 */

// Rate limit configurations for customer privacy requests
const RATE_LIMITS = {
  ORG_REQUESTS_PER_HOUR: 10,
  ORG_REQUESTS_PER_DAY: 50,
  IDENTIFIER_REQUESTS_PER_DAY: 5,
  ORG_WINDOW_SECONDS: 3600, // 1 hour
  DAY_WINDOW_SECONDS: 86400, // 24 hours
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
      return `${hours} hour${hours > 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes > 1 ? "s" : ""}`;
    }
  }
}

/**
 * Check rate limits for customer privacy requests
 */
async function checkCustomerPrivacyRateLimits(
  organizationId: string,
  identifierValue: string,
): Promise<void> {
  // Check organization rate limit (10 requests per hour)
  const orgLimit = await rateLimitService.checkOrganizationRateLimit(
    organizationId,
    "customer-privacy",
    RATE_LIMITS.ORG_REQUESTS_PER_HOUR,
    RATE_LIMITS.ORG_WINDOW_SECONDS,
  );

  if (orgLimit.limited) {
    const timeRemaining = formatTimeRemaining(orgLimit.resetAt);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many customer privacy requests from your organization. Please try again in ${timeRemaining}.`,
    });
  }

  // Check identifier rate limit (5 requests per day per identifier)
  const identifierKey = `customer-privacy:identifier:${identifierValue}`;
  const identifierLimit = await rateLimitService.checkEmailRateLimit(
    identifierKey,
    RATE_LIMITS.IDENTIFIER_REQUESTS_PER_DAY,
    RATE_LIMITS.DAY_WINDOW_SECONDS,
  );

  if (identifierLimit.limited) {
    const timeRemaining = formatTimeRemaining(identifierLimit.resetAt);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many requests for this customer identifier. Please try again in ${timeRemaining}.`,
    });
  }
}

export const customerPrivacyRouter = t.router({
  /**
   * Request a customer data export
   * Organization initiates export for their customer
   */
  requestExport: authenticatedProcedure
    .input(
      z.object({
        identifier: z.object({
          type: z.enum(["email", "phone", "externalId"]),
          value: z.string().min(1, "Identifier value is required"),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }

      // Check rate limits
      await checkCustomerPrivacyRateLimits(ctx.organizationId, input.identifier.value);

      try {
        const result = await privacyService.requestCustomerExport(
          ctx.organizationId,
          input.identifier,
          ctx.ipAddress,
          ctx.userAgent,
        );

        return {
          success: true,
          requestId: result.requestId,
          customerFound: result.customerFound,
          message: result.customerFound
            ? "A verification email has been sent to the customer. They must click the link to confirm the data export request."
            : "No customer found with this identifier, but a verification email has been sent if the identifier is an email address.",
          expiresAt: result.expiresAt,
        };
      } catch (error) {
        console.error("[Customer Privacy] Export request failed:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to process customer export request. Please try again later.";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Confirm customer data export with verification token
   * Can be public (customer verifies via email) or authenticated
   */
  confirmExport: publicProcedure
    .input(
      z.object({
        token: z.string().min(1, "Verification token is required"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await privacyService.confirmCustomerExport(input.token);

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
   * Request customer data deletion
   * Organization initiates deletion for their customer
   */
  requestDeletion: authenticatedProcedure
    .input(
      z.object({
        identifier: z.object({
          type: z.enum(["email", "phone", "externalId"]),
          value: z.string().min(1, "Identifier value is required"),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }

      // Check rate limits
      await checkCustomerPrivacyRateLimits(ctx.organizationId, input.identifier.value);

      try {
        const result = await privacyService.requestCustomerDeletion(
          ctx.organizationId,
          input.identifier,
          ctx.ipAddress,
          ctx.userAgent,
        );

        return {
          success: true,
          requestId: result.requestId,
          message:
            "A verification email has been sent to the customer. They must click the link to confirm the data deletion request. This action cannot be undone.",
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
   * Confirm customer data deletion with verification token
   * Can be public (customer verifies via email)
   */
  confirmDeletion: publicProcedure
    .input(
      z.object({
        token: z.string().min(1, "Verification token is required"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await privacyService.confirmCustomerDeletion(input.token);

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
   * Get status of a customer privacy request
   * Organization can check status of their customer's requests
   */
  getStatus: authenticatedProcedure
    .input(
      z.object({
        requestId: z.string().uuid("Invalid request ID"),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }

      try {
        const requestRepository = AppDataSource.getRepository(PrivacyRequest);
        const request = await requestRepository.findOne({
          where: {
            id: input.requestId,
            organizationId: ctx.organizationId,
            subjectType: "customer",
          },
          relations: ["job", "customer"],
        });

        if (!request) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Customer privacy request not found",
          });
        }

        return {
          success: true,
          id: request.id,
          type: request.type,
          status: request.status,
          identifierType: request.identifierType,
          identifierValue: request.identifierValue,
          createdAt: request.createdAt,
          completedAt: request.completedAt,
          jobId: request.jobId,
          jobStatus: request.job?.status,
          downloadAvailable: request.status === "completed" && request.type === "export",
          errorMessage: request.errorMessage,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Download customer export data
   * Requires valid request ID and download token
   * Public endpoint (customer downloads via email link)
   */
  downloadExport: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid("Invalid request ID"),
        downloadToken: z.string().min(1, "Download token is required"),
      }),
    )
    .query(async ({ input }) => {
      try {
        const result = await privacyService.downloadExport(input.requestId, input.downloadToken);

        return {
          success: true,
          data: result.data,
          fileName: result.fileName,
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
   * List all customer privacy requests for organization
   * Shows history of all requests made for customers
   */
  listRequests: authenticatedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        type: z.enum(["export", "deletion", "rectification"]).optional(),
        customerId: z.string().uuid().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }

      try {
        const requestRepository = AppDataSource.getRepository(PrivacyRequest);

        // Build query
        const where: any = {
          organizationId: ctx.organizationId,
          subjectType: "customer",
        };

        if (input.status) {
          where.status = input.status;
        }

        if (input.type) {
          where.type = input.type;
        }

        if (input.customerId) {
          where.customerId = input.customerId;
        }

        // Get total count
        const total = await requestRepository.count({ where });

        // Get paginated results
        const requests = await requestRepository.find({
          where,
          order: { createdAt: "DESC" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          relations: ["customer", "job"],
        });

        return {
          success: true,
          requests: requests.map((req) => ({
            id: req.id,
            type: req.type,
            status: req.status,
            email: req.email,
            identifierType: req.identifierType,
            identifierValue: req.identifierValue,
            customerId: req.customerId,
            customerName: req.customer?.name,
            createdAt: req.createdAt,
            completedAt: req.completedAt,
            jobStatus: req.job?.status,
          })),
          pagination: {
            page: input.page,
            limit: input.limit,
            total,
            totalPages: Math.ceil(total / input.limit),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),
});
