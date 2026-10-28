/**
 * Offline run harness (D7-7).
 *
 * A run is a batch of cases. Each case is a few seed turns that end with a
 * shopper message; it becomes one `runKind: "simulation"` conversation that
 * the orchestrator answers once, through the normal queue, in dry run (writes
 * are simulated). Simulation conversations are never billed (they are test
 * conversations), never delivered, broadcast or alerted on, and left out of
 * the Inbox and analytics (see simulation-kind.ts).
 *
 * A run feeds the queue a few conversations at a time (SIMULATION_CAPS), so a
 * batch never starves live shoppers. The LLM tokens each conversation spends
 * are recorded per model on the item and summed on the run; a run stops at its
 * token ceiling. Runs are capped per organization per month.
 *
 * What the AI did is read from each item's conversation (messages, action_log):
 * the replay runner and judge (lane L7b) build on that.
 */

import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageDirection, MessageType } from "@server/database/entities/message.entity";
import {
  SimulationRun,
  type SimulationUsage,
} from "@server/database/entities/simulation-run.entity";
import {
  SimulationRunItem,
  type SimulationSeedTurn,
} from "@server/database/entities/simulation-run-item.entity";
import { Organization } from "@server/entities/organization.entity";
import { Agent } from "@server/database/entities/agent.entity";
import { SIMULATION_CAPS } from "@server/config/simulation-caps";
import { withUsageCollector, type UsageEvent } from "@server/services/llm/usage-sink";
import {
  PLAYBOOK_VERSION_OVERRIDE_KEY,
  type PlaybookVersionOverride,
} from "@server/services/playbook-version-override";
import { createLogger } from "@server/lib/logger";
import { SIMULATION_RUN_KIND } from "./simulation-kind";

const logger = createLogger("simulation-harness");

export interface SimulationCase {
  seed: SimulationSeedTurn[];
  /** Opaque to the harness: lets the caller map items back to its cases. */
  sourceRef?: string | null;
}

export interface StartSimulationRunInput {
  organizationId: string;
  createdById?: string | null;
  kind?: string;
  label?: string | null;
  /** Default: the organization's default agent (else its first agent). */
  agentId?: string | null;
  playbookVersionOverride?: PlaybookVersionOverride | null;
  cases: SimulationCase[];
}

/** A request the harness refuses; `code` maps to a tRPC error. */
export class SimulationError extends Error {
  constructor(
    public readonly code: "BAD_REQUEST" | "NOT_FOUND" | "LIMIT_REACHED",
    message: string,
  ) {
    super(message);
  }
}

export interface SimulationAllowance {
  limit: number;
  used: number;
  remaining: number;
}

type ProcessConversation = (conversationId: string) => Promise<void>;

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function addUsage(usage: SimulationUsage, event: UsageEvent): SimulationUsage {
  const key = `${event.provider}:${event.model}`;
  const current = usage[key] ?? {
    calls: 0,
    promptTokens: 0,
    cachedPromptTokens: 0,
    completionTokens: 0,
  };
  return {
    ...usage,
    [key]: {
      calls: current.calls + 1,
      promptTokens: current.promptTokens + (event.usage.promptTokens || 0),
      cachedPromptTokens: current.cachedPromptTokens + (event.usage.cachedPromptTokens || 0),
      completionTokens: current.completionTokens + (event.usage.completionTokens || 0),
    },
  };
}

export function mergeUsage(a: SimulationUsage, b: SimulationUsage): SimulationUsage {
  const merged: SimulationUsage = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const current = merged[key];
    merged[key] = current
      ? {
          calls: current.calls + value.calls,
          promptTokens: current.promptTokens + value.promptTokens,
          cachedPromptTokens: current.cachedPromptTokens + value.cachedPromptTokens,
          completionTokens: current.completionTokens + value.completionTokens,
        }
      : value;
  }
  return merged;
}

export function totalTokens(usage: SimulationUsage): number {
  return Object.values(usage).reduce((sum, u) => sum + u.promptTokens + u.completionTokens, 0);
}

export function validateCases(cases: SimulationCase[]): void {
  if (cases.length === 0) {
    throw new SimulationError("BAD_REQUEST", "A run needs at least one case");
  }
  if (cases.length > SIMULATION_CAPS.maxItemsPerRun) {
    throw new SimulationError(
      "BAD_REQUEST",
      `A run takes at most ${SIMULATION_CAPS.maxItemsPerRun} cases`,
    );
  }
  cases.forEach((c, index) => {
    if (c.seed.length === 0 || c.seed.length > SIMULATION_CAPS.maxSeedTurns) {
      throw new SimulationError(
        "BAD_REQUEST",
        `Case ${index + 1} needs 1 to ${SIMULATION_CAPS.maxSeedTurns} turns`,
      );
    }
    if (c.seed.some((turn) => !turn.text.trim())) {
      throw new SimulationError("BAD_REQUEST", `Case ${index + 1} has an empty turn`);
    }
    if (c.seed[c.seed.length - 1].role !== "customer") {
      throw new SimulationError(
        "BAD_REQUEST",
        `Case ${index + 1} must end with a customer turn for the AI to answer`,
      );
    }
  });
}

export class SimulationHarnessService {
  private get runs() {
    return AppDataSource.getRepository(SimulationRun);
  }

  private get items() {
    return AppDataSource.getRepository(SimulationRunItem);
  }

  /** This month's simulated conversations against the organization's cap. */
  async getAllowance(organizationId: string): Promise<SimulationAllowance> {
    const organization = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
    });
    const limit = organization?.limits?.maxSimulationsPerMonth ?? SIMULATION_CAPS.defaultPerMonth;
    const used = await this.items
      .createQueryBuilder("item")
      .where("item.organization_id = :organizationId", { organizationId })
      .andWhere("item.created_at >= :since", { since: startOfMonthUtc() })
      .andWhere("item.status <> 'skipped'")
      .getCount();
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  async startRun(input: StartSimulationRunInput): Promise<SimulationRun> {
    validateCases(input.cases);

    if (input.agentId) {
      const agent = await AppDataSource.getRepository(Agent).findOne({
        where: { id: input.agentId, organization_id: input.organizationId },
      });
      if (!agent) throw new SimulationError("NOT_FOUND", "Agent not found");
    }

    const override = input.playbookVersionOverride ?? null;
    if (override) {
      const { PlaybookService } = await import("@server/services/playbook.service");
      const version = await new PlaybookService()
        .getVersion(input.organizationId, override.playbookId, override.versionId)
        .catch(() => null);
      if (!version) throw new SimulationError("NOT_FOUND", "Playbook version not found");
    }

    const allowance = await this.getAllowance(input.organizationId);
    if (input.cases.length > allowance.remaining) {
      throw new SimulationError(
        "LIMIT_REACHED",
        `This run needs ${input.cases.length} simulated conversations; ${allowance.remaining} of ${allowance.limit} are left this month`,
      );
    }

    const run = await AppDataSource.transaction(async (manager) => {
      const created = await manager.getRepository(SimulationRun).save(
        manager.getRepository(SimulationRun).create({
          organization_id: input.organizationId,
          kind: input.kind ?? "manual",
          label: input.label ?? null,
          status: "running",
          agent_id: input.agentId ?? null,
          playbook_id: override?.playbookId ?? null,
          playbook_version_id: override?.versionId ?? null,
          item_count: input.cases.length,
          created_by_id: input.createdById ?? null,
        }),
      );
      await manager.getRepository(SimulationRunItem).insert(
        input.cases.map((c, position) => ({
          run_id: created.id,
          organization_id: input.organizationId,
          position,
          status: "pending" as const,
          seed: c.seed.map((turn) => ({ role: turn.role, text: turn.text })),
          source_ref: c.sourceRef ?? null,
        })),
      );
      return created;
    });

    logger.info(
      { organizationId: input.organizationId, runId: run.id, items: input.cases.length },
      "Simulation run started",
    );
    await this.dispatchNext(run.id);
    return run;
  }

  async listRuns(organizationId: string, limit = 50): Promise<SimulationRun[]> {
    return this.runs.find({
      where: { organization_id: organizationId },
      order: { created_at: "DESC" },
      take: limit,
    });
  }

  async getRun(
    organizationId: string,
    runId: string,
  ): Promise<{ run: SimulationRun; items: SimulationRunItem[] } | null> {
    const run = await this.runs.findOne({ where: { id: runId, organization_id: organizationId } });
    if (!run) return null;
    const items = await this.items.find({ where: { run_id: runId }, order: { position: "ASC" } });
    return { run, items };
  }

  /** Stop a run: queued cases are skipped; the ones in progress finish. */
  async cancelRun(organizationId: string, runId: string): Promise<SimulationRun | null> {
    const run = await this.runs.findOne({ where: { id: runId, organization_id: organizationId } });
    if (!run) return null;
    if (run.status !== "running") return run;
    await this.stopRun(runId, "cancelled");
    return this.runs.findOne({ where: { id: runId } });
  }

  /**
   * Answer one simulated conversation (called by the orchestrator worker for
   * the "simulation" trigger). Never throws: a failure fails the item, and
   * the run moves on to its next case.
   */
  async runItem(conversationId: string, process: ProcessConversation): Promise<void> {
    const item = await this.items.findOne({
      where: { conversation_id: conversationId, status: "running" },
    });
    if (!item) {
      // Cancelled or timed out meanwhile: don't spend tokens on it.
      await this.closeConversation(conversationId);
      return;
    }

    let usage: SimulationUsage = {};
    let error: string | null = null;
    try {
      await withUsageCollector(
        (event) => {
          usage = addUsage(usage, event);
        },
        () => process(conversationId),
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn({ err, runId: item.run_id, itemId: item.id }, "Simulated conversation failed");
    }

    await this.finishItem(item, error ? "failed" : "completed", { usage, error });
    await this.dispatchNext(item.run_id);
  }

  /** Fail items stuck past the timeout (lost queue message, crashed worker). */
  async sweepStaleItems(): Promise<number> {
    const cutoff = new Date(Date.now() - SIMULATION_CAPS.itemTimeoutMs);
    const stale = await this.items
      .createQueryBuilder("item")
      .where("item.status = 'running'")
      .andWhere("item.started_at < :cutoff", { cutoff })
      .getMany();
    for (const item of stale) {
      await this.finishItem(item, "failed", { usage: {}, error: "Timed out" });
      await this.dispatchNext(item.run_id);
    }
    return stale.length;
  }

  /**
   * Claim the run's next cases up to its concurrency and queue them. The run
   * row lock keeps two finishing items from both claiming the same slot.
   */
  async dispatchNext(runId: string): Promise<void> {
    const claimed = await AppDataSource.transaction(async (manager) => {
      const run = await manager
        .getRepository(SimulationRun)
        .createQueryBuilder("run")
        .setLock("pessimistic_write")
        .where("run.id = :runId", { runId })
        .getOne();
      if (!run || run.status !== "running") return { run, items: [] as SimulationRunItem[] };

      const itemRepo = manager.getRepository(SimulationRunItem);
      const running = await itemRepo.count({ where: { run_id: runId, status: "running" } });
      const free = SIMULATION_CAPS.concurrencyPerRun - running;
      if (free <= 0) return { run, items: [] };

      const next = await itemRepo.find({
        where: { run_id: runId, status: "pending" },
        order: { position: "ASC" },
        take: free,
      });
      if (next.length === 0) {
        if (running === 0) {
          await manager
            .getRepository(SimulationRun)
            .update(runId, { status: "completed", completed_at: new Date() });
        }
        return { run, items: [] };
      }
      const startedAt = new Date();
      await itemRepo.update(
        next.map((i) => i.id),
        { status: "running", started_at: startedAt },
      );
      return { run, items: next.map((i) => ({ ...i, started_at: startedAt })) };
    });

    if (!claimed.run) return;
    for (const item of claimed.items) {
      try {
        await this.queueItem(claimed.run, item);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, runId, itemId: item.id }, "Could not queue simulated conversation");
        await this.finishItem(item, "failed", { usage: {}, error: message });
        await this.dispatchNext(runId);
      }
    }
  }

  /** Write the case into a new simulation conversation and queue it. */
  private async queueItem(run: SimulationRun, item: SimulationRunItem): Promise<void> {
    const agentId = run.agent_id ?? (await this.defaultAgentId(run.organization_id));
    const metadata: Record<string, unknown> = {
      runKind: SIMULATION_RUN_KIND,
      simulationRunId: run.id,
      simulationItemId: item.id,
      dryRun: true,
    };
    if (run.playbook_id && run.playbook_version_id) {
      metadata[PLAYBOOK_VERSION_OVERRIDE_KEY] = {
        playbookId: run.playbook_id,
        versionId: run.playbook_version_id,
      };
    }

    const conversations = AppDataSource.getRepository(Conversation);
    const conversation = await conversations.save(
      conversations.create({
        title: run.label
          ? `${run.label} #${item.position + 1}`
          : `Simulation #${item.position + 1}`,
        organization_id: run.organization_id,
        agent_id: agentId,
        customer_id: null,
        channel: "web",
        status: "open",
        context: {},
        metadata,
        needs_processing: false,
      }),
    );
    await this.items.update(item.id, { conversation_id: conversation.id });

    // Instructions first, then the history, then the AI's turn.
    await conversation.addInitialSystemMessage();
    await conversation.addInitialAgentInstructions();
    const base = Date.now();
    await AppDataSource.getRepository(Message).insert(
      item.seed.map((turn, index) => ({
        conversation_id: conversation.id,
        content: turn.text,
        type: turn.role === "customer" ? MessageType.CUSTOMER : MessageType.HUMAN_AGENT,
        direction: turn.role === "customer" ? MessageDirection.IN : MessageDirection.OUT,
        sender: turn.role === "customer" ? "customer" : "agent",
        created_at: new Date(base + index + 1),
      })),
    );
    await conversations.update(conversation.id, {
      needs_processing: true,
      lastMessageAt: new Date(base + item.seed.length),
    });

    const { orchestratorQueueService } =
      await import("@server/services/orchestrator-queue.service");
    const sent = await orchestratorQueueService.enqueue(
      conversation.id,
      run.organization_id,
      "simulation",
    );
    if (!sent) throw new Error("Queue unavailable");
  }

  private async defaultAgentId(organizationId: string): Promise<string | null> {
    const organization = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
    });
    if (organization?.defaultAgentId) return organization.defaultAgentId;
    const agent = await AppDataSource.getRepository(Agent).findOne({
      where: { organization_id: organizationId },
      order: { created_at: "ASC" },
    });
    return agent?.id ?? null;
  }

  private async finishItem(
    item: SimulationRunItem,
    status: "completed" | "failed",
    result: { usage: SimulationUsage; error: string | null },
  ): Promise<void> {
    if (item.conversation_id) await this.closeConversation(item.conversation_id);

    let capped = false;
    await AppDataSource.transaction(async (manager) => {
      const updated = await manager
        .getRepository(SimulationRunItem)
        .createQueryBuilder()
        .update()
        .set({ status, error: result.error, usage: result.usage, completed_at: new Date() })
        .where("id = :id AND status = 'running'", { id: item.id })
        .execute();
      if (!updated.affected) return; // already finished (sweep vs worker)

      const runRepo = manager.getRepository(SimulationRun);
      const run = await runRepo
        .createQueryBuilder("run")
        .setLock("pessimistic_write")
        .where("run.id = :id", { id: item.run_id })
        .getOne();
      if (!run) return;
      const usage = mergeUsage(run.usage ?? {}, result.usage);
      await runRepo.update(run.id, {
        usage,
        completed_count: run.completed_count + (status === "completed" ? 1 : 0),
        failed_count: run.failed_count + (status === "failed" ? 1 : 0),
      });
      capped = run.status === "running" && totalTokens(usage) >= SIMULATION_CAPS.maxTokensPerRun;
    });

    if (capped) {
      logger.warn({ runId: item.run_id }, "Simulation run reached its token ceiling");
      await this.stopRun(item.run_id, "capped");
    }
  }

  /** Skip the queued cases and mark the run stopped. */
  private async stopRun(runId: string, status: "capped" | "cancelled"): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const skipped = await manager
        .getRepository(SimulationRunItem)
        .createQueryBuilder()
        .update()
        .set({ status: "skipped" })
        .where("run_id = :runId AND status = 'pending'", { runId })
        .execute();
      await manager
        .getRepository(SimulationRun)
        .createQueryBuilder()
        .update()
        .set({
          status,
          completed_at: new Date(),
          skipped_count: () => `skipped_count + ${skipped.affected ?? 0}`,
        })
        .where("id = :runId", { runId })
        .execute();
    });
  }

  /**
   * Close without the normal close path: no hooks, broadcasts or outcome row.
   * Closed, the conversation then follows the organization's retention.
   */
  private async closeConversation(conversationId: string): Promise<void> {
    const now = new Date();
    await AppDataSource.getRepository(Conversation).update(conversationId, {
      status: "closed",
      needs_processing: false,
      closed_at: now,
      ended_at: now,
    });
  }
}

export const simulationHarnessService = new SimulationHarnessService();
