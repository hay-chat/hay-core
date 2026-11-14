import { router, scopedProcedure, publicProcedure } from "@server/trpc";
import { webchatExtensionsService } from "@server/services/webchat/webchat-extensions.service";
import {
  isUnderAttack,
  setUnderAttack,
  stateOf,
} from "@server/services/webchat/under-attack.service";
import { config } from "@server/config/env";
import { z } from "zod";
import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { customAiLabel, isAiLabelShown } from "@server/services/ai-disclosure";
import {
  WEBCHAT_LAUNCHER_ICONS,
  WEBCHAT_LAUNCHER_ICON_STYLES,
  WEBCHAT_THEME_MODES,
  WebchatPosition,
} from "@server/database/entities/webchat-settings.entity";
import { TRPCError } from "@trpc/server";
import { parseBase64Upload } from "@server/lib/upload-helper";
import { storageService } from "@server/services/storage.service";
import { MediaRejectedError, rasterizeSvgIcon } from "@server/services/media-sanitizer.service";
import { handleUpload } from "@server/lib/upload-helper";
import { isDashboardHost } from "@server/lib/webchat-origin";
import { getAvailability, typicalFirstReplyMinutes } from "@server/services/business-hours.service";
import {
  revealIdentitySecret,
  rotateIdentitySecret,
} from "@server/services/webchat/webchat-identity.service";
import { auditLogService } from "@server/services/audit-log.service";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("webchat-router");

// Every widget load asks for availability; a short cache keeps that off the database.
const AVAILABILITY_TTL_MS = 60_000;
const availabilityCache = new Map<string, { at: number; value: WidgetAvailability | null }>();

interface WidgetAvailability {
  state: "open" | "open_nobody_online" | "closed";
  nextOpening: string | null;
  timezone: string;
  hasSchedule: boolean;
  typicalReplyMinutes: number | null;
}

async function widgetAvailability(organizationId: string): Promise<WidgetAvailability | null> {
  const [isEnabled, organization] = await Promise.all([
    webchatSettingsService.isEnabled(organizationId),
    organizationRepository.findById(organizationId),
  ]);
  if (!isEnabled || !organization || organization.suspendedAt) return null;

  const scope = { organizationId, channel: "web" };
  const now = new Date();
  const [availability, typicalReplyMinutes] = await Promise.all([
    getAvailability(scope, now),
    typicalFirstReplyMinutes(scope, now),
  ]);
  return {
    state: availability.state,
    nextOpening: availability.nextOpening?.toISOString() ?? null,
    timezone: availability.timezone,
    hasSchedule: availability.hasSchedule,
    typicalReplyMinutes,
  };
}
import { formSchemaSchema } from "@hay/form-schema";

/**
 * Origin ("https://shop.com") of the page that loaded the widget, from Origin,
 * falling back to Referer. Null for opaque origins (the dashboard preview's
 * srcdoc frame sends "null") and for the Hay.chat dashboard itself.
 */
export function widgetPageOrigin(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  for (const name of ["origin", "referer"]) {
    const value = headers[name];
    if (typeof value !== "string" || !value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return isDashboardHost(url.hostname.toLowerCase()) ? null : url.origin;
    } catch {
      continue;
    }
  }
  return null;
}

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Enter a colour like #001df5");

export const webchatRouter = router({
  /**
   * Get webchat settings for the current organization
   */
  getSettings: scopedProcedure("webchat", "read").query(async ({ ctx }) => {
    const settings = await webchatSettingsService.getSettings(ctx.organizationId!);
    webchatSettingsService.importBrandingIfNeverDone(settings);
    return {
      ...(await webchatSettingsService.toView(settings)),
      underAttack: stateOf(settings),
      underAttackHours: config.underAttack.hours,
    };
  }),

  /**
   * Upload the widget logo (base64 data URI, like the organization logo). The
   * website import never replaces it.
   */
  uploadLogo: scopedProcedure("webchat", "write")
    .input(z.object({ logo: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await handleUpload(
        input.logo,
        "organizations",
        ctx.organizationId!,
        ctx.user!.id,
        { maxSize: 2 * 1024 * 1024 }, // 2MB, as for the organization logo
      );
      return await webchatSettingsService.setCustomLogo(ctx.organizationId!, result.upload.id);
    }),

  /** Remove the widget logo; the widget falls back to the organization logo. */
  removeLogo: scopedProcedure("webchat", "write").mutation(async ({ ctx }) => {
    return await webchatSettingsService.removeLogo(ctx.organizationId!);
  }),

  /**
   * The merchant's own chat button icon, as an SVG data URI. It is rendered to
   * a PNG here and only the PNG is stored, so no SVG ever reaches a visitor.
   */
  uploadLauncherIcon: scopedProcedure("webchat", "write")
    .input(z.object({ icon: z.string().max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      let png: Buffer;
      try {
        const parsed = parseBase64Upload(input.icon);
        if (parsed.mimeType !== "image/svg+xml") throw new MediaRejectedError("Upload an SVG file");
        png = await rasterizeSvgIcon(parsed.buffer);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof MediaRejectedError ? error.message : "Upload an SVG file",
        });
      }
      const result = await storageService.upload({
        buffer: png,
        originalName: "launcher-icon.png",
        mimeType: "image/png",
        folder: "organizations",
        organizationId: ctx.organizationId!,
        uploadedById: ctx.user!.id,
      });
      return await webchatSettingsService.setCustomLauncherIcon(
        ctx.organizationId!,
        result.upload.id,
      );
    }),

  /** Remove the uploaded button icon; the button goes back to the chat bubble. */
  removeLauncherIcon: scopedProcedure("webchat", "write").mutation(async ({ ctx }) => {
    return await webchatSettingsService.removeLauncherIcon(ctx.organizationId!);
  }),

  /**
   * Under-attack mode (D9-10): challenge every visitor for the next
   * UNDER_ATTACK_HOURS, or switch it off early.
   */
  setUnderAttack: scopedProcedure("webchat", "write")
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return await setUnderAttack(ctx.organizationId!, input.enabled);
    }),

  /**
   * Update webchat settings
   */
  updateSettings: scopedProcedure("webchat", "write")
    .input(
      z.object({
        widgetTitle: z.string().min(1).max(100).optional(),
        position: z.nativeEnum(WebchatPosition).optional(),
        themeMode: z.enum(WEBCHAT_THEME_MODES).optional(),
        brandColor: hexColorSchema.optional(),
        launcherIcon: z.enum(WEBCHAT_LAUNCHER_ICONS).optional(),
        launcherIconStyle: z.enum(WEBCHAT_LAUNCHER_ICON_STYLES).optional(),
        homeHeading: z
          .string()
          .trim()
          .max(120)
          .nullable()
          .optional()
          .transform((value) => (value === "" ? null : value)),
        showGreeting: z.boolean().optional(),
        greetingMessage: z.string().max(2000).nullable().optional(),
        teaserMessage: z.string().trim().max(200).nullable().optional(),
        csatEnabled: z.boolean().optional(),
        csatQuestion: z.string().trim().max(300).nullable().optional(),
        allowedDomains: z.array(z.string().trim().min(1).max(253)).max(200).optional(),
        isEnabled: z.boolean().optional(),
        customCss: z.string().max(50_000).nullable().optional(),
        spamClassifierEnabled: z.boolean().optional(),
        spamGuidance: z.string().max(2000).nullable().optional(),
        preChatForm: formSchemaSchema.nullable().optional(),
        pageTools: z
          .object({
            enabled: z.boolean(),
            allowedOrigins: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await webchatSettingsService.updateSettings(ctx.organizationId!, input);
    }),

  /**
   * Customer identity secret (D1): the key the store's server signs
   * `customerExternalId` with. A credential, so it sits with API keys, which
   * only org admins and owners hold. Created on first reveal.
   */
  revealIdentitySecret: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.READ).mutation(
    async ({ ctx }) => {
      const secret = await revealIdentitySecret(ctx.organizationId!);
      auditIdentitySecret(ctx, "revealed");
      return { secret };
    },
  ),

  /** Replace the identity secret; ids signed with the old one stop linking. */
  rotateIdentitySecret: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.UPDATE).mutation(
    async ({ ctx }) => {
      const secret = await rotateIdentitySecret(ctx.organizationId!);
      auditIdentitySecret(ctx, "rotated");
      return { secret };
    },
  ),

  /**
   * Get public configuration for the widget (no auth required)
   * Used by the widget to fetch configuration on load
   */
  getPublicConfig: publicProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        // Contribution types this widget build can render (e.g. "challenge@1").
        supports: z.array(z.string().max(40)).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // A disabled webchat or a suspended organization is not an error for the
      // widget: it answers `{ enabled: false }` and the widget renders nothing.
      const [isEnabled, organization] = await Promise.all([
        webchatSettingsService.isEnabled(input.organizationId),
        organizationRepository.findById(input.organizationId),
      ]);

      if (!isEnabled || !organization || organization.suspendedAt) {
        return { enabled: false as const };
      }

      // Install detection (C2): which site loads the widget, and when.
      const pageOrigin = widgetPageOrigin(ctx.req.headers);
      if (pageOrigin) {
        webchatSettingsService
          .recordWidgetLoad(input.organizationId, pageOrigin)
          .catch((error) => logger.warn({ err: error }, "Could not record the widget load"));
      }

      const underAttack = await isUnderAttack(input.organizationId);
      const [config, contributions] = await Promise.all([
        webchatSettingsService.getPublicConfig(input.organizationId),
        webchatExtensionsService.getPublicContributions(
          input.organizationId,
          input.supports ?? [],
          {
            underAttack,
          },
        ),
      ]);
      return {
        enabled: true as const,
        ...config,
        // Plugin contributions the widget can render (declarative, never code).
        contributions,
        // AI label on AI replies (D14-6). A null text means the widget's localized default.
        aiLabelShown: isAiLabelShown(organization, "web"),
        aiLabelText: customAiLabel(organization.settings),
      };
    }),

  /**
   * Team availability for the widget header and waiting state (D5-7, D5-10).
   * Public like getPublicConfig; answers nothing beyond open/closed, the next
   * opening and the typical first human reply.
   */
  getAvailability: publicProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const cached = availabilityCache.get(input.organizationId);
      if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.value;
      const value = await widgetAvailability(input.organizationId);
      if (availabilityCache.size > 5000) availabilityCache.clear();
      availabilityCache.set(input.organizationId, { at: Date.now(), value });
      return value;
    }),
});

function auditIdentitySecret(
  ctx: { user?: { id: string } | null; organizationId?: string | null; ipAddress?: string },
  change: "revealed" | "rotated",
): void {
  auditLogService
    .log({
      userId: ctx.user?.id,
      organizationId: ctx.organizationId ?? undefined,
      action: "security.setting.change",
      resource: "webchat_identity_secret",
      changes: { identitySecret: change },
      ipAddress: ctx.ipAddress,
    })
    .catch((error) => logger.warn({ err: error }, "Could not audit the identity secret"));
}
