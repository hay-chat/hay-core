import { t } from "@server/trpc";
import { z } from "zod";

export const documentsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    return [];
  }),
  create: t.procedure
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return [];
    }),
  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return [];
    }),
  delete: t.procedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return [];
    }),
});
