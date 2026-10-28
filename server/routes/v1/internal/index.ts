import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "@server/trpc/init";
import { internalProcedure } from "@server/trpc/middleware/internal";
import { organizationService } from "@server/services/organization.service";
import { organizationAccessService } from "@server/services/organization-access.service";
import {
  AGENT_PAUSE_REASONS,
  SUSPENSION_REASONS,
  accessNoticeSchema,
} from "@server/types/organization-access.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("internal");

/**
 * Operator-only procedures (shared-secret auth, see trpc/middleware/internal.ts).
 * Core stays billing-agnostic: an external system decides *when* an organization
 * loses access and tells core through these generic endpoints.
 */

const organizationIdInput = z.object({ organizationId: z.string().uuid() });

const internalOrganizationsRouter = router({
  getAccessState: internalProcedure.input(organizationIdInput).query(async ({ input }) => {
    const state = await organizationAccessService.getAccessState(input.organizationId);
    if (!state) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }
    return state;
  }),

  setAccessState: internalProcedure
    .input(
      organizationIdInput.extend({
        suspension: z
          .object({
            reason: z.enum(SUSPENSION_REASONS),
            redirectUrl: z.string().url().max(2048).optional(),
          })
          .nullable(),
        // Optional so an operator that predates agent pauses keeps working (= resume).
        agentPause: z
          .object({ reason: z.enum(AGENT_PAUSE_REASONS) })
          .nullable()
          .default(null),
        notice: accessNoticeSchema.nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const state = await organizationAccessService.setAccessState(input);
      if (!state) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }
      return state;
    }),

  /**
   * The current billing period (end exclusive), sent by the operator on every
   * usage run. The usage page and the exclusion allowance follow it; null goes
   * back to UTC calendar months.
   */
  setBillingPeriod: internalProcedure
    .input(
      organizationIdInput.extend({
        period: z
          .object({ start: z.coerce.date(), end: z.coerce.date() })
          .refine((p) => p.end.getTime() > p.start.getTime(), {
            message: "The period must end after it starts",
          })
          .nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const state = await organizationAccessService.setBillingPeriod(input);
      if (!state) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }
      return state;
    }),

  delete: internalProcedure.input(organizationIdInput).mutation(async ({ input }) => {
    const organization = await organizationService.findOne(input.organizationId);
    if (!organization) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    await organizationService.deleteWithData(organization);
    logger.warn({ orgId: organization.id }, "Organization deleted by operator");

    return { success: true };
  }),
});

export const internalRouter = router({
  organizations: internalOrganizationsRouter,
});
