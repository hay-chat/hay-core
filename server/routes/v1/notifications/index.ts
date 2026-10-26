import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { pushNotificationService } from "@server/services/push-notification.service";

/**
 * Notifications router: Web Push opt-in per device.
 *
 * `pushPublicKey` returns null when the server has no VAPID keys, which the
 * dashboard treats as "push alerts unavailable on this installation".
 */
const subscriptionInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  userAgent: z.string().max(512).optional(),
});

function requireOrganization(organizationId: string | undefined | null): string {
  if (!organizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
  }
  return organizationId;
}

export const notificationsRouter = t.router({
  pushPublicKey: authenticatedProcedure.query(() => ({
    publicKey: pushNotificationService.getPublicKey(),
  })),

  subscribePush: authenticatedProcedure
    .input(subscriptionInput)
    .mutation(async ({ ctx, input }) => {
      if (!pushNotificationService.isConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Push notifications are not configured on this server",
        });
      }
      const organizationId = requireOrganization(ctx.organizationId);
      const row = await pushNotificationService.subscribe(ctx.user!.id, organizationId, input);
      return { id: row.id };
    }),

  unsubscribePush: authenticatedProcedure
    .input(z.object({ endpoint: z.string().url().max(2048) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await pushNotificationService.unsubscribe(ctx.user!.id, input.endpoint);
      return { removed };
    }),

  /** Sends a notification to the caller's own devices so they can confirm the setup. */
  sendTestPush: authenticatedProcedure.mutation(async ({ ctx }) => {
    if (!pushNotificationService.isConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Push notifications are not configured on this server",
      });
    }
    return pushNotificationService.sendToUser(ctx.user!.id, {
      kind: "test",
      title: "Hay alerts are on",
      body: "You will be notified here when a conversation needs a human.",
      url: "/",
      tag: "test",
    });
  }),
});
