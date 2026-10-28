import { TRPCError } from "@trpc/server";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { organizationExportService } from "@server/services/organization-export.service";

/**
 * Settings → Privacy → "Download all data" (D15-6). Owner/admin only: the
 * organizations:export scope is held by the admin wildcard alone. Exempt from
 * the suspension lock, so a locked or cancelled owner can still take their data
 * out until the purge (D15-7, trpc/middleware/suspension.ts).
 */
export const organizationExportRouter = t.router({
  status: scopedProcedure(RESOURCES.ORGANIZATIONS, ACTIONS.EXPORT).query(({ ctx }) =>
    organizationExportService.getState(ctx.organizationId!),
  ),

  request: scopedProcedure(RESOURCES.ORGANIZATIONS, ACTIONS.EXPORT).mutation(({ ctx }) =>
    organizationExportService.request(ctx.organizationId!, ctx.user?.id),
  ),

  downloadLink: scopedProcedure(RESOURCES.ORGANIZATIONS, ACTIONS.EXPORT).mutation(
    async ({ ctx }) => {
      const link = await organizationExportService.downloadLink(ctx.organizationId!, ctx.user?.id);
      if (!link) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No export is ready to download. Start a new one.",
        });
      }
      return link;
    },
  ),
});
