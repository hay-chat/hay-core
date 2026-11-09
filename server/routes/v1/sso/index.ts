import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t } from "@server/trpc";
import { SSO_ASSIGNABLE_ROLES } from "@server/database/entities/sso-connection.entity";
import { requireMfaStepUp } from "@server/trpc/middleware/mfa";
import { scopedProcedure } from "@server/trpc/middleware/auth";
import { ACTIONS, RESOURCES } from "@server/types/scopes";
import { scimBaseUrl, scimService } from "@server/services/scim.service";
import { ssoService } from "@server/services/sso.service";

/** Setting up single sign-on is for the organization's owners, signed in as people. */
const ownerProcedure = scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE).use(
  ({ ctx, next }) => {
    if (ctx.user.authMethod !== "jwt" || ctx.user.getRole() !== "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the organization owner can manage single sign-on",
      });
    }
    return next();
  },
);

const roleSchema = z.enum(SSO_ASSIGNABLE_ROLES);

const commonSchema = {
  defaultRole: roleSchema,
  roleClaim: z.string().trim().max(100).nullish(),
  roleMapping: z
    .record(z.string().max(255), roleSchema)
    .refine((map) => Object.keys(map).length <= 50),
  enabled: z.boolean(),
};

const connectionSchema = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("oidc"),
    issuer: z.string().trim().url().max(512),
    clientId: z.string().trim().min(1).max(255),
    clientSecret: z.string().min(1).max(1024).optional(),
    ...commonSchema,
  }),
  z.object({
    protocol: z.literal("saml"),
    idpEntityId: z.string().trim().min(1).max(512),
    ssoUrl: z.string().trim().url().max(1024),
    certificate: z.string().trim().min(1).max(12_000),
    ...commonSchema,
  }),
]);

function actor(ctx: { user: { id: string }; ipAddress?: string; userAgent?: string }) {
  return { userId: ctx.user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
}

export const ssoRouter = t.router({
  getSettings: ownerProcedure.query(async ({ ctx }) => {
    return {
      connection: await ssoService.getConnection(ctx.organizationId!),
      saml: ssoService.samlServiceProviderDetails(ctx.organizationId!),
      scim: {
        baseUrl: scimBaseUrl(),
        token: await scimService.getTokenStatus(ctx.organizationId!),
      },
      domains: await ssoService.listDomains(ctx.organizationId!),
      enforced: ctx.user.userOrganization?.organization?.settings?.ssoEnforced === true,
      assignableRoles: SSO_ASSIGNABLE_ROLES,
    };
  }),

  saveConnection: ownerProcedure
    .use(requireMfaStepUp)
    .input(connectionSchema)
    .mutation(({ ctx, input }) =>
      ssoService.saveConnection(ctx.organizationId!, input, actor(ctx)),
    ),

  deleteConnection: ownerProcedure.use(requireMfaStepUp).mutation(async ({ ctx }) => {
    await ssoService.deleteConnection(ctx.organizationId!, actor(ctx));
    return { success: true };
  }),

  addDomain: ownerProcedure
    .input(z.object({ domain: z.string().trim().min(3).max(253) }))
    .mutation(async ({ ctx, input }) => {
      await ssoService.addDomain(ctx.organizationId!, input.domain, actor(ctx));
      return ssoService.listDomains(ctx.organizationId!);
    }),

  verifyDomain: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ssoService.verifyDomain(ctx.organizationId!, input.id, actor(ctx));
      return ssoService.listDomains(ctx.organizationId!);
    }),

  removeDomain: ownerProcedure
    .use(requireMfaStepUp)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ssoService.removeDomain(ctx.organizationId!, input.id, actor(ctx));
      return ssoService.listDomains(ctx.organizationId!);
    }),

  /** Requiring SSO needs a step-up; the owner turning it on stays the break-glass account. */
  setEnforcement: ownerProcedure
    .use(requireMfaStepUp)
    .input(z.object({ enforced: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ssoService.setEnforcement(ctx.organizationId!, input.enforced, {
        ...actor(ctx),
        role: ctx.user.getRole() ?? "member",
      });
      return { enforced: input.enforced };
    }),

  /** The token is returned here once; only its hash is kept. Creating another replaces it. */
  createScimToken: ownerProcedure
    .use(requireMfaStepUp)
    .mutation(({ ctx }) => scimService.createToken(ctx.organizationId!, actor(ctx))),

  revokeScimToken: ownerProcedure.use(requireMfaStepUp).mutation(async ({ ctx }) => {
    await scimService.revokeToken(ctx.organizationId!, actor(ctx));
    return { success: true };
  }),
});
