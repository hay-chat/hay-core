/**
 * Replay runner (D7-9).
 *
 * Replays past conversations (imported test transcripts, or Hay.chat's own
 * conversations) against the agent, usually with a playbook draft, in dry run.
 * Each customer turn is its own counterfactual: the real history up to that
 * turn (the shopper's messages and what a person actually answered) is seeded
 * into a simulation conversation, the AI answers once, and its reply is
 * compared with what was really sent next. Later turns reacted to the real
 * reply, not the AI's, so a whole-conversation replay would be fiction; one
 * turn at a time is not.
 *
 * Read tools return today's store data, not what was true when the shopper
 * wrote: the judge flags "store data changed since" on those turns.
 *
 * Replays are simulation runs (kind "replay"): free, never billed, never
 * delivered, and counted against the organization's monthly allowance.
 */

import { In } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType, MessageStatus } from "@server/database/entities/message.entity";
import { TestTranscript as TestTranscriptRow } from "@server/database/entities/test-transcript.entity";
import type { SimulationRun } from "@server/database/entities/simulation-run.entity";
import type { SimulationSeedTurn } from "@server/database/entities/simulation-run-item.entity";
import { SIMULATION_CAPS } from "@server/config/simulation-caps";
import { DeliveryState } from "@server/types/message-feedback.types";
import { isTestConversation } from "@server/services/close-classification/outcome-rules";
import {
  normalizeTranscript,
  type TestTranscriptTurn,
} from "@server/services/importers/transcripts/test-transcript";
import type { PlaybookVersionOverride } from "@server/services/playbook-version-override";
import {
  simulationHarnessService,
  SimulationError,
  type SimulationCase,
} from "./simulation-harness.service";

export const REPLAY_RUN_KIND = "replay";

/** A conversation to replay, in the neutral transcript shape. */
export interface ReplaySource {
  /** "transcript:<id>" or "conversation:<id>". */
  ref: string;
  title: string | null;
  turns: TestTranscriptTurn[];
}

export interface StartReplayInput {
  organizationId: string;
  createdById?: string | null;
  label?: string | null;
  agentId?: string | null;
  playbookVersionOverride?: PlaybookVersionOverride | null;
  transcriptIds?: string[];
  conversationIds?: string[];
  /** Also replay the organization's N most recently closed conversations. */
  recentConversations?: number | null;
  /** Replay at most this many customer turns per conversation (the first ones). */
  maxTurnsPerConversation?: number | null;
}

/**
 * One case per customer turn: the history up to and including that turn, and
 * what was sent next as the reference reply (null when the shopper had the
 * last word). A history longer than the seed cap keeps its latest turns.
 */
export function replayCases(
  source: ReplaySource,
  options: { maxTurns?: number | null } = {},
): SimulationCase[] {
  const cases: SimulationCase[] = [];
  source.turns.forEach((turn, index) => {
    if (turn.role !== "customer") return;
    if (options.maxTurns && cases.length >= options.maxTurns) return;
    const history: SimulationSeedTurn[] = source.turns
      .slice(0, index + 1)
      .map((t) => ({ role: t.role, text: t.text }));
    const next = source.turns[index + 1];
    cases.push({
      seed: history.slice(-SIMULATION_CAPS.maxSeedTurns),
      sourceRef: `${source.ref}:${index}`,
      expectations: {
        referenceReply: next?.role === "agent" ? next.text : null,
        replay: true,
        originalAt: turn.timestamp ?? null,
        title: source.title,
      },
    });
  });
  return cases;
}

/** A conversation's delivered customer and team/AI messages, as transcript turns. */
export function conversationTurns(messages: Message[]): TestTranscriptTurn[] {
  const turns: TestTranscriptTurn[] = [];
  for (const message of messages) {
    if (!message.content?.trim()) continue;
    if (message.type === MessageType.CUSTOMER) {
      turns.push({ role: "customer", text: message.content, timestamp: iso(message.created_at) });
      continue;
    }
    if (message.type !== MessageType.BOT_AGENT && message.type !== MessageType.HUMAN_AGENT) {
      continue;
    }
    // Only what the shopper saw: not queued or blocked drafts.
    if (
      message.deliveryState === DeliveryState.QUEUED ||
      message.deliveryState === DeliveryState.BLOCKED ||
      message.status === MessageStatus.REJECTED
    ) {
      continue;
    }
    turns.push({ role: "agent", text: message.content, timestamp: iso(message.created_at) });
  }
  return turns;
}

/** A replayed turn this recent is treated as "now": store data had no time to change. */
export const STORE_DATA_FRESH_MS = 60 * 60 * 1000;

/**
 * "Store data changed since": a replayed turn whose AI read the live store
 * (orders, stock, tracking) got today's data, not what was true when the
 * shopper wrote. True when the turn is older than an hour or its time is
 * unknown, and the AI made at least one successful read. Test cases are not
 * replays: they are meant to run against today's data.
 */
export function storeDataMayHaveChanged(
  expectations: { replay?: boolean; originalAt?: string | null } | null | undefined,
  successfulReads: number,
  now: Date = new Date(),
): boolean {
  if (!expectations?.replay || successfulReads === 0) return false;
  if (!expectations.originalAt) return true;
  const at = new Date(expectations.originalAt).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > STORE_DATA_FRESH_MS;
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}

export class ReplayService {
  async loadSources(
    organizationId: string,
    input: { transcriptIds?: string[]; conversationIds?: string[] },
  ): Promise<ReplaySource[]> {
    const sources: ReplaySource[] = [];

    const transcriptIds = [...new Set(input.transcriptIds ?? [])];
    if (transcriptIds.length > 0) {
      const rows = await AppDataSource.getRepository(TestTranscriptRow).find({
        where: { organization_id: organizationId, id: In(transcriptIds) },
        order: { created_at: "ASC" },
      });
      if (rows.length !== transcriptIds.length) {
        throw new SimulationError("NOT_FOUND", "Transcript not found");
      }
      for (const row of rows) {
        sources.push({ ref: `transcript:${row.id}`, title: row.title, turns: row.turns });
      }
    }

    const conversationIds = [...new Set(input.conversationIds ?? [])];
    if (conversationIds.length > 0) {
      const conversations = await AppDataSource.getRepository(Conversation).find({
        where: { organization_id: organizationId, id: In(conversationIds) },
        order: { created_at: "ASC" },
      });
      // Test conversations (playground, earlier simulations) are not real traffic.
      const real = conversations.filter((c) => !c.deleted_at && !isTestConversation(c.metadata));
      if (real.length !== conversationIds.length) {
        throw new SimulationError("NOT_FOUND", "Conversation not found");
      }
      const messages = await AppDataSource.getRepository(Message).find({
        where: { conversation_id: In(conversationIds) },
        order: { created_at: "ASC" },
      });
      for (const conversation of real) {
        const normalized = normalizeTranscript({
          turns: conversationTurns(messages.filter((m) => m.conversation_id === conversation.id)),
        });
        sources.push({
          ref: `conversation:${conversation.id}`,
          title: conversation.title || null,
          turns: normalized?.turns ?? [],
        });
      }
    }

    return sources;
  }

  /** The N most recently closed real conversations (not playground, not simulations). */
  async recentConversationIds(organizationId: string, count: number): Promise<string[]> {
    const rows = await AppDataSource.getRepository(Conversation)
      .createQueryBuilder("c")
      .select(["c.id", "c.metadata"])
      .where("c.organization_id = :organizationId", { organizationId })
      .andWhere("c.status = 'closed'")
      .andWhere("c.deleted_at IS NULL")
      .orderBy("c.updated_at", "DESC")
      // Test conversations are filtered below; read extra to make up for them.
      .take(Math.min(count * 3, 600))
      .getMany();
    return rows
      .filter((c) => !isTestConversation(c.metadata))
      .slice(0, count)
      .map((c) => c.id);
  }

  /**
   * The conversations behind an Insight (D3-17), newest first, so a fix can
   * be replayed against them before it is published. Only the cluster's own
   * members in this organization, not merged or deleted conversations.
   */
  async insightConversationIds(
    organizationId: string,
    clusterId: string,
    limit: number,
  ): Promise<string[]> {
    const rows: Array<{ id: string; metadata: Record<string, unknown> | null }> =
      await AppDataSource.query(
        `SELECT conv.id, conv.metadata
           FROM insight_clusters cl
           JOIN insight_cluster_members m ON m.cluster_id = cl.id
           JOIN insight_issues i ON i.id = m.insight_issue_id
           JOIN conversations conv ON conv.id = i.conversation_id
          WHERE cl.id = $1 AND cl.organization_id = $2
            AND conv.organization_id = $2 AND conv.deleted_at IS NULL
          GROUP BY conv.id, conv.metadata
          ORDER BY max(i.created_at) DESC
          LIMIT $3`,
        [clusterId, organizationId, limit * 2],
      );
    return rows
      .filter((c) => !isTestConversation(c.metadata))
      .slice(0, limit)
      .map((c) => c.id);
  }

  /** Turn the sources into one case per customer turn and start the run. */
  async start(input: StartReplayInput): Promise<SimulationRun> {
    const recent = input.recentConversations
      ? await this.recentConversationIds(input.organizationId, input.recentConversations)
      : [];
    const sources = await this.loadSources(input.organizationId, {
      transcriptIds: input.transcriptIds,
      conversationIds: [...(input.conversationIds ?? []), ...recent],
    });
    if (sources.length === 0) {
      throw new SimulationError("BAD_REQUEST", "Pick at least one conversation to replay");
    }
    const cases = sources.flatMap((source) =>
      replayCases(source, { maxTurns: input.maxTurnsPerConversation }),
    );
    if (cases.length === 0) {
      throw new SimulationError("BAD_REQUEST", "These conversations have no customer messages");
    }
    return simulationHarnessService.startRun({
      organizationId: input.organizationId,
      createdById: input.createdById ?? null,
      kind: REPLAY_RUN_KIND,
      label: input.label ?? null,
      agentId: input.agentId ?? null,
      playbookVersionOverride: input.playbookVersionOverride ?? null,
      cases,
    });
  }
}

export const replayService = new ReplayService();
