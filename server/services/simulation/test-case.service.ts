/**
 * Test cases and the pre-publish regression run (D7-12).
 *
 * A test case is a conversation up to a shopper message plus what a good
 * answer looks like. They are saved from a replay result, from an AI reply a
 * team member edited or blocked in Require Approval, from a thumbs up/down,
 * or from an Insight (D3-17). Before a playbook draft is published, that
 * playbook's cases run against the draft (a simulation run of kind
 * "test_cases": dry, free, counted against the monthly allowance) and the
 * publish dialog warns about failures, especially cases that passed before.
 * It warns; it never blocks publishing.
 */

import { In, LessThan } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageStatus, MessageType } from "@server/database/entities/message.entity";
import { MessageFeedback } from "@server/database/entities/message-feedback.entity";
import { SimulationRun } from "@server/database/entities/simulation-run.entity";
import {
  SimulationRunItem,
  type SimulationExpectations,
  type SimulationSeedTurn,
} from "@server/database/entities/simulation-run-item.entity";
import { TestCase, type TestCaseSource } from "@server/database/entities/test-case.entity";
import { InsightIssue } from "@server/database/entities/insight-issue.entity";
import { Organization } from "@server/entities/organization.entity";
import { SIMULATION_CAPS } from "@server/config/simulation-caps";
import { FeedbackRating } from "@server/types/message-feedback.types";
import type { PlaybookVersionOverride } from "@server/services/playbook-version-override";
import { createLogger } from "@server/lib/logger";
import { conversationTurns } from "./replay.service";
import { simulationHarnessService, SimulationError } from "./simulation-harness.service";
import type { VerdictCheck } from "./turn-judge.service";

const logger = createLogger("test-cases");

export const TEST_CASES_RUN_KIND = "test_cases";
const SOURCE_REF_PREFIX = "test_case:";

/** What the caller may add or override when saving a case. */
export interface TestCaseOverrides {
  title?: string | null;
  expectedOutcome?: string | null;
  expectHandoff?: boolean | null;
  mustCallTools?: string[];
  mustNotCallTools?: string[];
  playbookId?: string | null;
}

export interface RegressionCaseResult {
  testCaseId: string | null;
  title: string;
  status: SimulationRunItem["status"];
  /** null while running, or when the judge could not decide. */
  passed: boolean | null;
  /** The same case's result in the previous test-case run, when there was one. */
  previouslyPassed: boolean | null;
  newFailure: boolean;
  reply: string | null;
  failedChecks: VerdictCheck[];
  reasoning: string | null;
  conversationId: string | null;
}

export interface RegressionResults {
  run: SimulationRun;
  cases: RegressionCaseResult[];
  failing: number;
  newFailures: number;
  inProgress: number;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function titleFromSeed(seed: SimulationSeedTurn[]): string {
  const last = [...seed].reverse().find((t) => t.role === "customer");
  return clip((last?.text ?? "Test case").replace(/\s+/g, " ").trim(), 120);
}

/** Drop trailing team turns: a case must end with the shopper message to answer. */
function endOnCustomer(seed: SimulationSeedTurn[]): SimulationSeedTurn[] {
  const result = [...seed];
  while (result.length > 0 && result[result.length - 1].role !== "customer") result.pop();
  return result.slice(-SIMULATION_CAPS.maxSeedTurns);
}

function applyOverrides(
  expectations: SimulationExpectations,
  overrides: TestCaseOverrides,
): SimulationExpectations {
  const merged: SimulationExpectations = { ...expectations };
  if (overrides.expectedOutcome?.trim()) merged.expectedOutcome = overrides.expectedOutcome.trim();
  if (typeof overrides.expectHandoff === "boolean") merged.expectHandoff = overrides.expectHandoff;
  if (overrides.mustCallTools?.length) merged.mustCallTools = overrides.mustCallTools;
  if (overrides.mustNotCallTools?.length) merged.mustNotCallTools = overrides.mustNotCallTools;
  // Test cases run against today's store data: not a replay of the past.
  delete merged.replay;
  delete merged.originalAt;
  delete merged.title;
  return merged;
}

export class TestCaseService {
  private get repo() {
    return AppDataSource.getRepository(TestCase);
  }

  async create(input: {
    organizationId: string;
    createdById?: string | null;
    seed: SimulationSeedTurn[];
    expectations: SimulationExpectations;
    source: TestCaseSource;
    sourceRef?: string | null;
    playbookId?: string | null;
    overrides?: TestCaseOverrides;
  }): Promise<TestCase> {
    const overrides = input.overrides ?? {};
    const seed = endOnCustomer(input.seed);
    if (seed.length === 0) {
      throw new SimulationError("BAD_REQUEST", "There is no shopper message to test");
    }
    return this.repo.save(
      this.repo.create({
        organization_id: input.organizationId,
        created_by_id: input.createdById ?? null,
        title: clip(overrides.title?.trim() || titleFromSeed(seed), 255),
        seed,
        expectations: applyOverrides(input.expectations, overrides),
        source: input.source,
        source_ref: input.sourceRef ?? null,
        playbook_id:
          overrides.playbookId !== undefined ? overrides.playbookId : (input.playbookId ?? null),
      }),
    );
  }

  /** Save a replay or test result as a case: the same history, the same reference. */
  async createFromRunItem(
    organizationId: string,
    itemId: string,
    overrides: TestCaseOverrides = {},
    createdById: string | null = null,
  ): Promise<TestCase> {
    const item = await AppDataSource.getRepository(SimulationRunItem).findOne({
      where: { id: itemId, organization_id: organizationId },
    });
    if (!item) throw new SimulationError("NOT_FOUND", "Test result not found");
    const run = await AppDataSource.getRepository(SimulationRun).findOne({
      where: { id: item.run_id },
    });
    return this.create({
      organizationId,
      createdById,
      seed: item.seed,
      expectations: item.expectations ?? {},
      source: "replay",
      sourceRef: `run_item:${item.id}`,
      playbookId: item.verdict?.playbookId ?? run?.playbook_id ?? null,
      overrides: { title: item.expectations?.title ?? undefined, ...overrides },
    });
  }

  /**
   * Save an AI reply as a case. What a good answer is depends on what the
   * team said about it: an edited reply is the reference and the AI's
   * version is to avoid; a blocked or thumbed-down reply is to avoid (the
   * feedback comment becomes the expected outcome); a thumbed-up reply is
   * the reference.
   */
  async createFromMessage(
    organizationId: string,
    messageId: string,
    overrides: TestCaseOverrides = {},
    createdById: string | null = null,
  ): Promise<TestCase> {
    const messages = AppDataSource.getRepository(Message);
    const message = await messages.findOne({ where: { id: messageId } });
    const conversation = message
      ? await AppDataSource.getRepository(Conversation).findOne({
          where: { id: message.conversation_id, organization_id: organizationId },
        })
      : null;
    if (!message || !conversation || message.type !== MessageType.BOT_AGENT) {
      throw new SimulationError("NOT_FOUND", "AI reply not found");
    }

    const earlier = await messages.find({
      where: { conversation_id: conversation.id, created_at: LessThan(message.created_at) },
      order: { created_at: "ASC" },
    });
    const seed = conversationTurns(earlier).map((t) => ({ role: t.role, text: t.text }));

    const feedback = await AppDataSource.getRepository(MessageFeedback).findOne({
      where: { messageId, organizationId },
      order: { createdAt: "DESC" },
    });

    let source: TestCaseSource = "conversation";
    const expectations: SimulationExpectations = {};
    if (message.status === MessageStatus.EDITED) {
      source = "approval_edit";
      expectations.referenceReply = message.content;
      expectations.avoidReply = message.originalContent ?? null;
    } else if (message.status === MessageStatus.REJECTED) {
      source = "approval_block";
      expectations.avoidReply = message.content;
    } else if (feedback?.rating === FeedbackRating.BAD) {
      source = "feedback";
      expectations.avoidReply = message.content;
      expectations.expectedOutcome = feedback.comment?.trim() || null;
    } else if (feedback?.rating === FeedbackRating.GOOD) {
      source = "feedback";
      expectations.referenceReply = message.content;
    } else {
      expectations.referenceReply = message.content;
    }

    return this.create({
      organizationId,
      createdById,
      seed,
      expectations,
      source,
      sourceRef: `message:${message.id}`,
      playbookId: conversation.playbook_id,
      overrides,
    });
  }

  /**
   * Save the conversation behind an Insight issue as a case (D3-17): the
   * history up to the flagged AI reply (or the whole conversation), with the
   * issue's summary as what the reply must avoid (negative) or keep doing.
   */
  async createFromInsightIssue(
    organizationId: string,
    issueId: string,
    overrides: TestCaseOverrides = {},
    createdById: string | null = null,
  ): Promise<TestCase> {
    const issue = await AppDataSource.getRepository(InsightIssue).findOne({
      where: { id: issueId, organization_id: organizationId },
    });
    const conversation = issue?.conversation_id
      ? await AppDataSource.getRepository(Conversation).findOne({
          where: { id: issue.conversation_id, organization_id: organizationId },
        })
      : null;
    if (!issue || !conversation) {
      throw new SimulationError("NOT_FOUND", "This insight has no conversation to test");
    }

    const messages = AppDataSource.getRepository(Message);
    const flagged = issue.message_id
      ? await messages.findOne({
          where: { id: issue.message_id, conversation_id: conversation.id },
        })
      : null;
    const history = await messages.find({
      where: {
        conversation_id: conversation.id,
        ...(flagged ? { created_at: LessThan(flagged.created_at) } : {}),
      },
      order: { created_at: "ASC" },
    });
    const seed = conversationTurns(history).map((t) => ({ role: t.role, text: t.text }));

    const expectations: SimulationExpectations = {
      expectedOutcome:
        issue.polarity === "positive"
          ? `Keep doing this: ${issue.summary}`
          : `The reply must not repeat this problem: ${issue.summary}`,
    };
    if (flagged?.type === MessageType.BOT_AGENT) {
      if (issue.polarity === "positive") expectations.referenceReply = flagged.content;
      else expectations.avoidReply = flagged.content;
    }

    return this.create({
      organizationId,
      createdById,
      seed,
      expectations,
      source: "insight",
      sourceRef: `insight_issue:${issue.id}`,
      playbookId: conversation.playbook_id,
      overrides: { title: clip(issue.summary, 255), ...overrides },
    });
  }

  async list(organizationId: string, options: { playbookId?: string | null } = {}) {
    return this.repo.find({
      where: {
        organization_id: organizationId,
        ...(options.playbookId ? { playbook_id: options.playbookId } : {}),
      },
      order: { created_at: "DESC" },
      take: SIMULATION_CAPS.maxItemsPerRun,
    });
  }

  async count(organizationId: string, playbookId: string): Promise<number> {
    return this.repo.count({ where: { organization_id: organizationId, playbook_id: playbookId } });
  }

  async remove(organizationId: string, ids: string[]): Promise<number> {
    const result = await this.repo.delete({ organization_id: organizationId, id: In(ids) });
    return result.affected ?? 0;
  }

  /**
   * Run a playbook's cases (or every case) against a draft, before publishing.
   * Throws BAD_REQUEST when there are none.
   */
  async startRegression(input: {
    organizationId: string;
    createdById?: string | null;
    playbookId?: string | null;
    playbookVersionOverride?: PlaybookVersionOverride | null;
    agentId?: string | null;
    label?: string | null;
  }): Promise<SimulationRun> {
    const cases = await this.list(input.organizationId, { playbookId: input.playbookId });
    if (cases.length === 0) {
      throw new SimulationError("BAD_REQUEST", "There are no test cases to run");
    }
    return simulationHarnessService.startRun({
      organizationId: input.organizationId,
      createdById: input.createdById ?? null,
      kind: TEST_CASES_RUN_KIND,
      label: input.label ?? null,
      agentId: input.agentId ?? null,
      playbookVersionOverride: input.playbookVersionOverride ?? null,
      cases: cases.map((c) => ({
        seed: c.seed,
        sourceRef: `${SOURCE_REF_PREFIX}${c.id}`,
        expectations: { ...c.expectations, title: c.title },
      })),
    });
  }

  /** Pass/fail per case, and which ones passed in the previous run but fail now. */
  async regressionResults(organizationId: string, runId: string): Promise<RegressionResults> {
    const result = await simulationHarnessService.getRun(organizationId, runId);
    if (!result || result.run.kind !== TEST_CASES_RUN_KIND) {
      throw new SimulationError("NOT_FOUND", "Test run not found");
    }
    const { run, items } = result;

    // The latest judged result per case from earlier test-case runs.
    const refs = items.map((i) => i.source_ref).filter((r): r is string => !!r);
    const previous = new Map<string, boolean>();
    if (refs.length > 0) {
      const rows: Array<{ source_ref: string; passed: boolean }> = await AppDataSource.query(
        `SELECT DISTINCT ON (item.source_ref) item.source_ref, (item.verdict->>'passed')::boolean AS passed
           FROM simulation_run_items item
           JOIN simulation_runs run ON run.id = item.run_id
          WHERE item.organization_id = $1
            AND run.kind = $2
            AND item.run_id <> $3
            AND item.created_at < $4
            AND item.source_ref = ANY($5)
            AND item.verdict->>'passed' IN ('true', 'false')
          ORDER BY item.source_ref, item.created_at DESC`,
        [organizationId, TEST_CASES_RUN_KIND, run.id, run.created_at, refs],
      );
      for (const row of rows) previous.set(row.source_ref, row.passed);
    }

    const cases = items.map((item): RegressionCaseResult => {
      const passed = item.verdict?.passed ?? null;
      const previouslyPassed = item.source_ref ? (previous.get(item.source_ref) ?? null) : null;
      return {
        testCaseId: item.source_ref?.startsWith(SOURCE_REF_PREFIX)
          ? item.source_ref.slice(SOURCE_REF_PREFIX.length)
          : null,
        title: item.expectations?.title ?? titleFromSeed(item.seed),
        status: item.status,
        passed,
        previouslyPassed,
        newFailure: passed === false && previouslyPassed === true,
        reply: item.verdict?.reply ?? null,
        failedChecks: (item.verdict?.checks ?? []).filter((c) => !c.passed),
        reasoning: item.verdict?.judge?.reasoning ?? null,
        conversationId: item.conversation_id,
      };
    });

    return {
      run,
      cases,
      failing: cases.filter((c) => c.passed === false).length,
      newFailures: cases.filter((c) => c.newFailure).length,
      inProgress: items.filter((i) => i.status === "pending" || i.status === "running").length,
    };
  }

  /** Test cases follow the organization's retention, like imported transcripts. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const organizations = await AppDataSource.getRepository(Organization)
      .createQueryBuilder("org")
      .where("(org.settings->>'retentionDays')::int > 0")
      .getMany();
    let deleted = 0;
    for (const org of organizations) {
      const retentionDays = org.settings?.retentionDays;
      if (!retentionDays || retentionDays <= 0) continue;
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      try {
        const result = await this.repo.delete({
          organization_id: org.id,
          created_at: LessThan(cutoff),
        });
        deleted += result.affected ?? 0;
      } catch (error) {
        logger.error({ error, organizationId: org.id }, "Failed to delete expired test cases");
      }
    }
    return deleted;
  }
}

export const testCaseService = new TestCaseService();
