import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import type { EmailSendingDomain } from "@server/database/entities/email-sending-domain.entity";
import { emailDomainService, EmailDomainError } from "@server/services/email-domains.service";

/**
 * Custom email sending domain (D13-9): optional; the platform address stays
 * the default until the domain is verified.
 */

function toDto(row: EmailSendingDomain | null) {
  if (!row) return null;
  return {
    domain: row.domain,
    status: row.status,
    verified: row.status === "verified",
    records: row.records,
    verifiedAt: row.verified_at,
  };
}

const ERROR_CODES = {
  not_configured: "PRECONDITION_FAILED",
  invalid_domain: "BAD_REQUEST",
  conflict: "CONFLICT",
  provider_error: "BAD_GATEWAY",
} as const;

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof EmailDomainError) {
      throw new TRPCError({ code: ERROR_CODES[error.code], message: error.message });
    }
    throw error;
  }
}

export const emailDomainsRouter = t.router({
  get: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ).query(async ({ ctx }) =>
    toDto(await emailDomainService.refresh(ctx.organizationId!)),
  ),

  create: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(z.object({ domain: z.string().min(3).max(253) }))
    .mutation(async ({ ctx, input }) =>
      run(async () => toDto(await emailDomainService.create(ctx.organizationId!, input.domain))),
    ),

  verify: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE).mutation(
    async ({ ctx }) => run(async () => toDto(await emailDomainService.verify(ctx.organizationId!))),
  ),

  remove: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE).mutation(
    async ({ ctx }) =>
      run(async () => {
        await emailDomainService.remove(ctx.organizationId!);
        return { success: true };
      }),
  ),
});
