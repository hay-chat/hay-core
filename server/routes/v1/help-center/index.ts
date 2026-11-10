import { z } from "zod";
import { t } from "@server/trpc";
import { scopedProcedure } from "@server/trpc/middleware/auth";
import { rateLimitMiddleware, RateLimits } from "@server/trpc/middleware/rate-limit";
import { ACTIONS, RESOURCES } from "@server/types/scopes";
import { SupportedLanguage } from "@server/types/language.types";
import {
  HELP_CENTER_FONTS,
  HELP_CENTER_LAYOUTS,
} from "@server/database/entities/help-center.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import {
  helpCenterService,
  signPreviewToken,
} from "@server/services/help-center/help-center.service";
import { suggestSubdomain } from "@server/services/help-center/subdomain";
import {
  defaultUrl,
  helpCenterBaseHostname,
  isHelpCenterEnabled,
} from "@server/services/help-center/urls";

const readProcedure = scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ);
/** Publishing a public website is a decision for the organization's admins. */
const adminProcedure = scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE);

const nameSchema = z.string().trim().min(1).max(120);
const subdomainSchema = z.string().trim().min(1).max(63);
const languageSchema = z.nativeEnum(SupportedLanguage);

export const helpCenterThemeSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(HELP_CENTER_FONTS),
  layout: z.enum(HELP_CENTER_LAYOUTS),
  heroTitle: z.string().trim().max(120).nullable(),
  heroSubtitle: z.string().trim().max(240).nullable(),
  showPoweredBy: z.boolean(),
});

const collectionFields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullish(),
  icon: z.string().trim().max(16).nullish(),
};

/** Every procedure here is authenticated; the rate-limit middleware only widens the type. */
function actor(ctx: { user: { id: string } | null; ipAddress?: string; userAgent?: string }) {
  return { userId: ctx.user!.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent };
}

export const helpCenterRouter = t.router({
  /** Everything the dashboard needs to show the help center, or the setup form. */
  get: readProcedure.query(async ({ ctx }) => {
    const enabled = isHelpCenterEnabled();
    const helpCenter = enabled
      ? await helpCenterService.findByOrganization(ctx.organizationId!)
      : null;
    let suggestedSubdomain = "";
    if (enabled && !helpCenter) {
      const organization = await organizationRepository.findById(ctx.organizationId!);
      suggestedSubdomain = suggestSubdomain(organization?.name ?? "");
    }
    return {
      /** False when this server has no HELP_CENTER_DOMAIN: the feature is unavailable. */
      enabled,
      baseDomain: enabled ? helpCenterBaseHostname() : "",
      suggestedSubdomain,
      helpCenter: helpCenter ? helpCenterService.view(helpCenter) : null,
    };
  }),

  checkSubdomain: adminProcedure
    .use(rateLimitMiddleware(RateLimits.PER_MINUTE))
    .input(z.object({ subdomain: z.string().max(100) }))
    .query(({ ctx, input }) =>
      helpCenterService.checkSubdomain(input.subdomain, ctx.organizationId!),
    ),

  create: adminProcedure
    .input(
      z.object({ name: nameSchema, subdomain: subdomainSchema, defaultLanguage: languageSchema }),
    )
    .mutation(async ({ ctx, input }) =>
      helpCenterService.view(
        await helpCenterService.create(ctx.organizationId!, input, actor(ctx)),
      ),
    ),

  update: adminProcedure
    .input(
      z.object({
        name: nameSchema.optional(),
        subdomain: subdomainSchema.optional(),
        defaultLanguage: languageSchema.optional(),
        searchIndexing: z.boolean().optional(),
        theme: helpCenterThemeSchema.partial().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      helpCenterService.view(await helpCenterService.update(ctx.organizationId!, input)),
    ),

  setPublished: adminProcedure
    .input(z.object({ published: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      helpCenterService.view(
        await helpCenterService.setPublished(ctx.organizationId!, input.published, actor(ctx)),
      ),
    ),

  /** A link that shows the site as it is now, even while it is offline. Expires in an hour. */
  getPreviewLink: readProcedure.query(async ({ ctx }) => {
    const helpCenter = await helpCenterService.findByOrganization(ctx.organizationId!);
    if (!helpCenter) return null;
    const token = signPreviewToken(helpCenter.id);
    return { baseUrl: defaultUrl(helpCenter), token };
  }),

  listCollections: readProcedure.query(({ ctx }) =>
    helpCenterService.listCollections(ctx.organizationId!),
  ),

  createCollection: adminProcedure
    .input(z.object(collectionFields))
    .mutation(async ({ ctx, input }) => {
      const collection = await helpCenterService.createCollection(ctx.organizationId!, input);
      return { id: collection.id };
    }),

  updateCollection: adminProcedure
    .input(
      z
        .object({ id: z.string().uuid(), ...collectionFields })
        .partial()
        .required({ id: true }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      await helpCenterService.updateCollection(ctx.organizationId!, id, fields);
      return { success: true };
    }),

  deleteCollection: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await helpCenterService.deleteCollection(ctx.organizationId!, input.id);
      return { success: true };
    }),

  reorderCollections: adminProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await helpCenterService.reorderCollections(ctx.organizationId!, input.ids);
      return { success: true };
    }),

  /** Sets a collection's articles, in order, and makes each of those documents public. */
  setCollectionArticles: adminProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        documentIds: z.array(z.string().uuid()).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await helpCenterService.setCollectionArticles(
        ctx.organizationId!,
        input.collectionId,
        input.documentIds,
      );
      return { success: true };
    }),

  setCustomDomain: adminProcedure
    .input(z.object({ domain: z.string().trim().min(1).max(253) }))
    .mutation(async ({ ctx, input }) =>
      helpCenterService.view(
        await helpCenterService.setCustomDomain(ctx.organizationId!, input.domain, actor(ctx)),
      ),
    ),

  verifyCustomDomain: adminProcedure
    .use(rateLimitMiddleware(RateLimits.PER_MINUTE))
    .mutation(async ({ ctx }) =>
      helpCenterService.view(
        await helpCenterService.verifyCustomDomain(ctx.organizationId!, actor(ctx)),
      ),
    ),

  removeCustomDomain: adminProcedure.mutation(async ({ ctx }) =>
    helpCenterService.view(
      await helpCenterService.removeCustomDomain(ctx.organizationId!, actor(ctx)),
    ),
  ),
});
