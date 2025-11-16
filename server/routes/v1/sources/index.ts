import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { SourceService } from "../../../services/source.service";
import { SourceCategory } from "../../../types/source.types";
import { TRPCError } from "@trpc/server";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

const sourceService = new SourceService();

const registerSourceSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  category: z.nativeEnum(SourceCategory),
  pluginId: z.string().max(100).optional(),
  icon: z.string().max(50).optional(),
  metadata: z.record(z.any()).optional(),
});

export const sourcesRouter = t.router({
  list: scopedProcedure(RESOURCES.SOURCES, ACTIONS.READ).query(async () => {
    const sources = await sourceService.getAllSources();
    return sources;
  }),

  get: scopedProcedure(RESOURCES.SOURCES, ACTIONS.READ)
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const source = await sourceService.getSourceById(input.id);

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source not found",
        });
      }

      return source;
    }),

  getByCategory: scopedProcedure(RESOURCES.SOURCES, ACTIONS.READ)
    .input(z.object({ category: z.nativeEnum(SourceCategory) }))
    .query(async ({ input }) => {
      const sources = await sourceService.getSourcesByCategory(input.category);
      return sources;
    }),

  // Future: for plugin system to register new sources
  register: scopedProcedure(RESOURCES.SOURCES, ACTIONS.CREATE)
    .input(registerSourceSchema)
    .mutation(async ({ input }) => {
      try {
        const source = await sourceService.registerSource(input);
        return source;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to register source",
        });
      }
    }),

  deactivate: scopedProcedure(RESOURCES.SOURCES, ACTIONS.UPDATE)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const success = await sourceService.deactivateSource(input.id);

        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source not found",
          });
        }

        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to deactivate source",
        });
      }
    }),

  activate: scopedProcedure(RESOURCES.SOURCES, ACTIONS.UPDATE)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const success = await sourceService.activateSource(input.id);

      if (!success) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source not found",
        });
      }

      return { success: true };
    }),
});
