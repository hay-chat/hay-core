/**
 * Setup playbooks: draft one per platform request once its platform is connected, and turn it on.
 *
 * Drafts are created with `playbookService.createPlaybook` and stay drafts until a person turns
 * them on, which goes through `publishDraft` so the active version is recorded. Generation is
 * idempotent: a question that already has a playbook is skipped, concurrent calls share one run,
 * and a draft that lost a race is deleted again.
 *
 * Write actions keep their approval: the draft lists the write categories its tools use as the
 * playbook's own approval list (tighten-only), on top of the organization's action approval.
 *
 * @module services/setup/playbooks
 */

import { TRPCError } from "@trpc/server";
import { PlaybookService } from "@server/services/playbook.service";
import { collectMentionReferences } from "@server/services/playbook-instructions-text";
import { mcpRegistryService } from "@server/services/mcp-registry.service";
import { organizationService } from "@server/services/organization.service";
import { APPROVAL_CATEGORIES } from "@server/types/organization-settings.types";
import type { SetupHandle, SetupQuestion } from "@server/types/setup.types";
import type { MCPTool } from "@server/services/mcp-registry.service";
import { createLogger } from "@server/lib/logger";
import type { BoardPlugin } from "./board";
import {
  generatePlan,
  planToDocument,
  type GenerationOutcome,
  type GenerationTool,
} from "./playbook-generation";
import { readSetup, updateSetup } from "./store";

const logger = createLogger("setup-playbooks");
const playbookService = new PlaybookService();

/** The organization's tools of one plugin, in the form generation and validation use. */
export function toGenerationTools(tools: MCPTool[], pluginId: string): GenerationTool[] {
  return tools
    .filter((t) => t.pluginId === pluginId)
    .map((t) => ({
      id: `${t.pluginId}:${t.name}`,
      pluginId: t.pluginId,
      name: t.name,
      description: t.description ?? "",
      readOnly: t.risk?.readOnly ?? false,
      category: t.risk?.readOnly === false ? t.risk.category : null,
    }));
}

/** Write categories a playbook's tools use that the organization can require approval for. */
export function approvalCategoriesFor(tools: GenerationTool[]): string[] {
  const allowed: readonly string[] = APPROVAL_CATEGORIES;
  return [
    ...new Set(
      tools.flatMap((t) =>
        !t.readOnly && t.category && allowed.includes(t.category) ? [t.category] : [],
      ),
    ),
  ];
}

/** Questions that need a playbook now: platform connected, nothing generated, nothing tried yet. */
export function questionsToGenerate(
  questions: SetupQuestion[],
  pluginForNeed: (need: SetupHandle) => BoardPlugin | undefined,
  only?: string[],
): { question: SetupQuestion; plugin: BoardPlugin }[] {
  return questions.flatMap((question) => {
    if (!question.needs || question.playbookId) return [];
    // Explicitly asked ids may retry an earlier attempt; the automatic run never does.
    if (question.playbookAttempt && !only?.includes(question.id)) return [];
    if (only && !only.includes(question.id)) return [];
    const plugin = pluginForNeed(question.needs);
    return plugin?.connected ? [{ question, plugin }] : [];
  });
}

/** One run per organization and question at a time. */
const inFlight = new Map<string, Promise<void>>();

export interface GenerateDeps {
  plan: (
    organizationId: string,
    request: string,
    tools: GenerationTool[],
    language: string | null | undefined,
  ) => Promise<GenerationOutcome>;
}

const defaultGenerateDeps: GenerateDeps = { plan: generatePlan };

async function generateOne(
  organizationId: string,
  question: SetupQuestion,
  plugin: BoardPlugin,
  orgTools: MCPTool[],
  language: string | null | undefined,
  deps: GenerateDeps,
): Promise<void> {
  const outcome = await deps.plan(
    organizationId,
    question.text,
    toGenerationTools(orgTools, plugin.id),
    language,
  );

  if (outcome.kind !== "plan") {
    await updateSetup(organizationId, (current) => ({
      ...current,
      questions: current.questions.map((q) =>
        q.id === question.id && !q.playbookId
          ? {
              ...q,
              playbookAttempt: {
                outcome: outcome.kind === "no_tool" ? "no_tool" : "failed",
                at: new Date().toISOString(),
              },
            }
          : q,
      ),
    }));
    return;
  }

  const { plan, tools } = outcome;
  const playbook = await playbookService.createPlaybook(organizationId, {
    title: plan.title,
    trigger: plan.trigger,
    instructions: planToDocument(plan, tools),
  });
  const categories = approvalCategoriesFor(tools);
  if (categories.length > 0) {
    await playbookService.updatePlaybook(organizationId, playbook.id, {
      approvalCategories: categories,
    });
  }

  let kept = false;
  await updateSetup(organizationId, (current) => ({
    ...current,
    questions: current.questions.map((q) => {
      // Another call, or an edit that removed the question, got here first: don't attach.
      if (q.id !== question.id || q.playbookId) return q;
      kept = true;
      return { ...q, playbookId: playbook.id, playbookAttempt: undefined };
    }),
  }));
  if (!kept) await playbookService.deletePlaybook(organizationId, playbook.id);
}

/**
 * Drafts a playbook for every connected platform request that has none. Never throws for a
 * single question: that row is marked and the rest continue.
 */
export async function generatePlaybooksFor(
  organizationId: string,
  pluginForNeed: (need: SetupHandle) => BoardPlugin | undefined,
  only?: string[],
  deps: GenerateDeps = defaultGenerateDeps,
): Promise<void> {
  const setup = await readSetup(organizationId);
  const targets = questionsToGenerate(setup.questions, pluginForNeed, only);
  if (targets.length === 0) return;

  const [orgTools, organization] = await Promise.all([
    mcpRegistryService.getToolsForOrg(organizationId),
    organizationService.findOne(organizationId),
  ]);

  await Promise.all(
    targets.map(({ question, plugin }) => {
      const key = `${organizationId}:${question.id}`;
      const running = inFlight.get(key);
      if (running) return running;
      const started = generateOne(
        organizationId,
        question,
        plugin,
        orgTools,
        organization?.defaultLanguage,
        deps,
      )
        .catch((err) => {
          logger.warn(
            { err, organizationId, questionId: question.id },
            "Playbook generation failed",
          );
          return updateSetup(organizationId, (current) => ({
            ...current,
            questions: current.questions.map((q) =>
              q.id === question.id && !q.playbookId
                ? {
                    ...q,
                    playbookAttempt: { outcome: "failed" as const, at: new Date().toISOString() },
                  }
                : q,
            ),
          })).then(() => undefined);
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    }),
  );
}

/**
 * Turns a question's draft playbook on with `publishDraft`. Idempotent: an active playbook is
 * left alone. Refuses when the draft names a tool the organization no longer has.
 */
export async function turnOnPlaybook(
  organizationId: string,
  userId: string,
  question: SetupQuestion,
): Promise<void> {
  if (!question.playbookId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This request has no playbook yet" });
  }
  const playbook = await playbookService.getPlaybook(organizationId, question.playbookId);
  if (!playbook) throw new TRPCError({ code: "NOT_FOUND", message: "Playbook not found" });
  if (playbook.status === "active") return;

  // Exact `pluginId:tool` ids only: a bare name can pass loose validation and fail at runtime.
  const available = new Set(
    (await mcpRegistryService.getToolsForOrg(organizationId)).map((t) => `${t.pluginId}:${t.name}`),
  );
  const missing = collectMentionReferences(playbook.instructions).actions.filter(
    (action) => !available.has(action.id),
  );
  if (missing.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This playbook uses a tool that is no longer available",
    });
  }
  await playbookService.publishDraft(organizationId, playbook.id, userId);
}
