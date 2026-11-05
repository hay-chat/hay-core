import { z } from "zod";
import { authenticatedProcedure } from "@server/trpc";
import {
  readPluginSetupStatus,
  type SetupStatus,
} from "@server/services/plugin-setup-status.service";

/**
 * What the plugin reports about its own setup, or null when it declares no
 * status handler, is not enabled, or does not answer in time. The dashboard
 * then judges the status from what core knows.
 */
export const getSetupStatus = authenticatedProcedure
  .input(z.object({ pluginId: z.string() }))
  .query(
    ({ ctx, input }): Promise<SetupStatus | null> =>
      readPluginSetupStatus(ctx.organizationId!, input.pluginId),
  );
