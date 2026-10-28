import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { SIMULATION_CAPS } from "@server/config/simulation-caps";
import {
  simulationHarnessService,
  SimulationError,
} from "@server/services/simulation/simulation-harness.service";

/**
 * Offline simulation runs (D7-7): batches of simulated conversations, answered
 * in dry run, never delivered nor billed, capped per month. Replays and test
 * cases (lane L7b) start runs through the same service.
 */

const seedTurnSchema = z.object({
  role: z.enum(["customer", "agent"]),
  text: z.string().min(1).max(10_000),
});

const startSchema = z.object({
  label: z.string().max(255).optional(),
  agentId: z.string().uuid().optional(),
  playbookVersionOverride: z
    .object({ playbookId: z.string().uuid(), versionId: z.string().uuid() })
    .optional(),
  cases: z
    .array(
      z.object({
        seed: z.array(seedTurnSchema).min(1).max(SIMULATION_CAPS.maxSeedTurns),
        sourceRef: z.string().max(255).optional(),
      }),
    )
    .min(1)
    .max(SIMULATION_CAPS.maxItemsPerRun),
});

function toTrpcError(error: unknown): never {
  if (error instanceof SimulationError) {
    throw new TRPCError({
      code: error.code === "LIMIT_REACHED" ? "FORBIDDEN" : error.code,
      message: error.message,
    });
  }
  throw error;
}

export const simulationsRouter = t.router({
  allowance: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ).query(async ({ ctx }) =>
    simulationHarnessService.getAllowance(ctx.organizationId!),
  ),

  start: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(startSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await simulationHarnessService.startRun({
          organizationId: ctx.organizationId!,
          createdById: ctx.user?.id ?? null,
          label: input.label ?? null,
          agentId: input.agentId ?? null,
          playbookVersionOverride: input.playbookVersionOverride ?? null,
          cases: input.cases,
        });
      } catch (error) {
        toTrpcError(error);
      }
    }),

  list: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) =>
      simulationHarnessService.listRuns(ctx.organizationId!, input?.limit ?? 50),
    ),

  get: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.READ)
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await simulationHarnessService.getRun(ctx.organizationId!, input.runId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      return result;
    }),

  cancel: scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE)
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await simulationHarnessService.cancelRun(ctx.organizationId!, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      return run;
    }),
});
