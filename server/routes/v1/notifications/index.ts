import { t, authenticatedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { pushNotificationService } from "@server/services/push-notification.service";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";

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
  userAgent: z.string().max(255).optional(),
});

function assertConfigured(): void {
  if (!pushNotificationService.isConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Push notifications are not configured on this server",
    });
  }
}

export const notificationsRouter = t.router({
  pushPublicKey: authenticatedProcedure.query(() => ({
    publicKey: pushNotificationService.getPublicKey(),
  })),

  subscribePush: authenticatedProcedure
    .input(subscriptionInput)
    .mutation(async ({ ctx, input }) => {
      assertConfigured();
      await pushNotificationService.subscribe(ctx.user!.id, input);
      return { subscribed: true };
    }),

  /**
   * The service worker's `pushsubscriptionchange` handler: the browser
   * replaced this device's subscription. No access token in a service worker;
   * the old endpoint finds the device and the old subscription's `auth` secret
   * (known only to the device and this server) proves it.
   */
  rotatePush: publicProcedure
    .input(
      subscriptionInput.extend({
        oldEndpoint: z.string().url().max(2048),
        oldAuth: z.string().min(1).max(512),
      }),
    )
    .mutation(async ({ input }) => {
      const { oldEndpoint, oldAuth, ...subscription } = input;
      const rotated = await pushNotificationService.rotate(oldEndpoint, oldAuth, subscription);
      return { rotated };
    }),

  unsubscribePush: authenticatedProcedure
    .input(z.object({ endpoint: z.string().url().max(2048) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await pushNotificationService.unsubscribe(ctx.user!.id, input.endpoint);
      return { removed };
    }),

  /** Sends a notification to the caller's own devices so they can confirm the setup. */
  sendTestPush: authenticatedProcedure.mutation(async ({ ctx }) => {
    assertConfigured();
    return pushNotificationService.sendTest(ctx.user!.id, ctx.organizationId!);
  }),

  /** Lock-screen privacy: alerts say only "A customer needs a human" (per person, all devices). */
  alertPrivacy: authenticatedProcedure.query(async ({ ctx }) => {
    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: ctx.user!.id },
      select: { id: true, hideAlertPreview: true },
    });
    return { hidePreview: user?.hideAlertPreview ?? false };
  }),

  setAlertPrivacy: authenticatedProcedure
    .input(z.object({ hidePreview: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await AppDataSource.getRepository(User).update(
        { id: ctx.user!.id },
        { hideAlertPreview: input.hidePreview },
      );
      return { hidePreview: input.hidePreview };
    }),
});
