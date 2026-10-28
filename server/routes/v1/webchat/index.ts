import { router, scopedProcedure, publicProcedure } from "@server/trpc";
import { webchatExtensionsService } from "@server/services/webchat/webchat-extensions.service";
import { z } from "zod";
import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { customAiLabel, isAiLabelShown } from "@server/services/ai-disclosure";
import { WebchatPosition, WebchatTheme } from "@server/database/entities/webchat-settings.entity";
import { getAvailability, typicalFirstReplyMinutes } from "@server/services/business-hours.service";

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

export const webchatRouter = router({
  /**
   * Get webchat settings for the current organization
   */
  getSettings: scopedProcedure("webchat", "read").query(async ({ ctx }) => {
    return await webchatSettingsService.getSettings(ctx.organizationId!);
  }),

  /**
   * Update webchat settings
   */
  updateSettings: scopedProcedure("webchat", "write")
    .input(
      z.object({
        widgetTitle: z.string().min(1).max(100).optional(),
        widgetSubtitle: z.string().max(200).nullable().optional(),
        position: z.nativeEnum(WebchatPosition).optional(),
        theme: z.nativeEnum(WebchatTheme).optional(),
        showGreeting: z.boolean().optional(),
        greetingMessage: z.string().nullable().optional(),
        allowedDomains: z.array(z.string()).optional(),
        isEnabled: z.boolean().optional(),
        customCss: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await webchatSettingsService.updateSettings(ctx.organizationId!, input);
    }),

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
    .query(async ({ input }) => {
      // A disabled webchat or a suspended organization is not an error for the
      // widget: it answers `{ enabled: false }` and the widget renders nothing.
      const [isEnabled, organization] = await Promise.all([
        webchatSettingsService.isEnabled(input.organizationId),
        organizationRepository.findById(input.organizationId),
      ]);

      if (!isEnabled || !organization || organization.suspendedAt) {
        return { enabled: false as const };
      }

      const [config, contributions] = await Promise.all([
        webchatSettingsService.getPublicConfig(input.organizationId),
        webchatExtensionsService.getPublicContributions(input.organizationId, input.supports ?? [], {
          underAttack: false,
        }),
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
