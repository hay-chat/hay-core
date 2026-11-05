/**
 * In-app setup: reads and writes the board for one organization.
 *
 * Stored answers live in `settings.setup`; row statuses are worked out on every read from the
 * site's sync state, documents and playbooks (see board.ts). Only `checkQuestions`,
 * `addAnswer` and `addQuestion` call a model.
 *
 * @module services/setup/setup.service
 */

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { Playbook, PlaybookStatus } from "@server/database/entities/playbook.entity";
import { In } from "typeorm";
import { organizationService } from "@server/services/organization.service";
import {
  isPluginVisibleToOrganization,
  pluginManagerService,
} from "@server/services/plugin-manager.service";
import {
  type BusinessType,
  type SetupBoard,
  type SetupCheckResult,
  type SetupQuestion,
  type SetupSettings,
  type SetupSuggestions,
} from "@server/types/setup.types";
import {
  buildBoard,
  isEverythingReady,
  pluginFor,
  type BoardFacts,
  type BoardPlugin,
} from "./board";
import { fillAssistantIfEmpty } from "./assistant";
import { connectedPluginIds } from "./connection";
import { stepsFromInstructions } from "./playbook-generation";
import { generatePlaybooksFor, turnOnPlaybook } from "./playbooks";
import { catalogFor, catalogLocale, findCatalogQuestion } from "./catalog";
import { CHECK_CONCURRENCY, checkQuestion, mapWithConcurrency } from "./check";
import { saveAnswerDocument } from "./answer-document";
import { inferBusinessType as inferFromSite, addScheme } from "./infer";
import { readSiteState, startSiteRead, type SiteReading } from "./site";
import { readSetup, updateSetup } from "./store";

export const MAX_QUESTIONS = 30;

async function organizationLanguage(organizationId: string): Promise<string | undefined> {
  const organization = await organizationService.findOne(organizationId);
  return organization?.defaultLanguage;
}

function visiblePlugins(organizationId: string) {
  return pluginManagerService
    .getAllPlugins()
    .filter((p) => isPluginVisibleToOrganization(p, organizationId));
}

/**
 * Platforms that can handle a customer request, with whether each is really connected. Only
 * asks about connections when a question needs a platform, and only for plugins that declare
 * a handle.
 */
async function boardPlugins(organizationId: string, setup: SetupSettings): Promise<BoardPlugin[]> {
  const plugins = visiblePlugins(organizationId).map((p) => ({
    id: p.pluginId,
    name: p.name,
    handles: p.manifest?.setup?.handles ?? [],
    businessTypes: p.manifest?.setup?.businessTypes ?? [],
  }));
  const wanted = setup.questions.some((q) => q.needs)
    ? plugins.filter((p) => p.handles.length > 0).map((p) => p.id)
    : [];
  const connected = await connectedPluginIds(organizationId, wanted);
  return plugins.map((p) => ({ ...p, connected: connected.has(p.id) }));
}

/** True when the org has a conversation that is not a playground chat or a replay/simulation run. */
export async function hasRealConversations(organizationId: string): Promise<boolean> {
  const rows: unknown[] = await AppDataSource.query(
    `SELECT 1 FROM conversations
      WHERE organization_id = $1
        AND NOT (
          COALESCE(metadata->>'sourceId', '') = 'playground'
          OR COALESCE(metadata->>'isPlayground', '') = 'true'
          OR jsonb_typeof(metadata->'runKind') = 'string'
        )
      LIMIT 1`,
    [organizationId],
  );
  return rows.length > 0;
}

async function loadPlaybooks(setup: SetupSettings) {
  const ids = setup.questions.map((q) => q.playbookId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const found = await AppDataSource.getRepository(Playbook).find({
    where: { id: In(ids) },
    select: { id: true, title: true, status: true, instructions: true },
  });
  return found.map((p) => ({
    id: p.id,
    title: p.title,
    active: p.status === PlaybookStatus.ACTIVE,
    steps: stepsFromInstructions(p.instructions),
  }));
}

async function loadFacts(organizationId: string, setup: SetupSettings, site?: SiteReading) {
  const [siteReading, playbooks, real, plugins] = await Promise.all([
    site ?? readSiteState(organizationId, setup.website),
    loadPlaybooks(setup),
    hasRealConversations(organizationId),
    boardPlugins(organizationId, setup),
  ]);
  const facts: BoardFacts = {
    setup,
    site: siteReading,
    plugins,
    playbooks,
    hasRealConversations: real,
  };
  return facts;
}

/**
 * Stamps `finishedAt` the first time every row, including platform rows, is ready. Rows only
 * become ready after real documents, connections and active playbooks, so this cannot fire early.
 */
async function finishIfReady(organizationId: string, board: SetupBoard): Promise<SetupBoard> {
  if (board.finishedAt || !isEverythingReady(board.rows)) return board;
  const saved = await updateSetup(organizationId, (current) => ({
    ...current,
    finishedAt: current.finishedAt ?? new Date().toISOString(),
  }));
  return { ...board, finishedAt: saved.finishedAt, shouldPrompt: false };
}

async function boardFor(organizationId: string, setup?: SetupSettings): Promise<SetupBoard> {
  const current = setup ?? (await readSetup(organizationId));
  return finishIfReady(organizationId, buildBoard(await loadFacts(organizationId, current)));
}

export function getBoard(organizationId: string): Promise<SetupBoard> {
  return boardFor(organizationId);
}

export async function getSuggestions(
  organizationId: string,
  businessType: BusinessType,
): Promise<SetupSuggestions> {
  const language = await organizationLanguage(organizationId);
  const plugins = visiblePlugins(organizationId);

  const channels = new Map<string, string>([
    ["webchat", catalogLocale(language) === "pt-BR" ? "Chat no site" : "Website chat"],
  ]);
  for (const p of plugins) {
    const channel = p.manifest?.channel;
    if (channel && !channels.has(channel)) channels.set(channel, p.name);
  }

  return {
    questions: catalogFor(businessType, language),
    plugins: plugins.flatMap((p) => {
      const hints = p.manifest?.setup;
      if (!hints || !hints.businessTypes.includes(businessType)) return [];
      return [{ id: p.pluginId, name: p.name, group: hints.group, handles: hints.handles ?? [] }];
    }),
    channels: [...channels].map(([id, name]) => ({ id, name })),
  };
}

export function inferBusinessType(organizationId: string, website: string) {
  return inferFromSite(organizationId, website);
}

/**
 * Merge incoming questions into the stored ones by id. A question that is still there keeps its
 * check and playbook; one whose wording changed keeps its playbook but loses a check that was
 * made for the old wording.
 */
export function mergeQuestions(
  stored: SetupQuestion[],
  incoming: { id?: string; text: string }[],
): SetupQuestion[] {
  const byId = new Map(stored.map((q) => [q.id, q]));
  const used = new Set<string>();
  const merged: SetupQuestion[] = [];

  for (const item of incoming) {
    const text = item.text.trim();
    const id = item.id;
    if (id && used.has(id)) continue;

    const prior = id ? byId.get(id) : undefined;
    if (prior) {
      used.add(prior.id);
      merged.push({
        ...prior,
        text,
        check: prior.text === text ? prior.check : undefined,
      });
      continue;
    }

    const catalog = id ? findCatalogQuestion(id) : undefined;
    if (catalog) {
      used.add(catalog.id);
      merged.push({
        id: catalog.id,
        text,
        source: "catalog",
        ...(catalog.needs ? { needs: catalog.needs } : {}),
      });
      continue;
    }

    // Unknown or missing id: a new custom question. Client-chosen ids are never trusted.
    const fresh = `custom.${randomUUID()}`;
    used.add(fresh);
    merged.push({ id: fresh, text, source: "custom" });
  }
  return merged;
}

export interface SaveAnswersInput {
  businessType: BusinessType;
  website?: string;
  toolPluginIds: string[];
  channels: string[];
  questions: { id?: string; text: string }[];
}

export async function saveAnswers(
  organizationId: string,
  input: SaveAnswersInput,
): Promise<SetupBoard> {
  const website = input.website?.trim() ? addScheme(input.website.trim()) : undefined;

  const saved = await updateSetup(organizationId, (current) => ({
    ...current,
    businessType: input.businessType,
    website,
    toolPluginIds: [...new Set(input.toolPluginIds)],
    channels: [...new Set(input.channels)],
    questions: mergeQuestions(current.questions, input.questions),
    answeredAt: new Date().toISOString(),
    dismissedAt: undefined,
  }));

  // A bad address must not fail the save: it shows up as `site.state === "failed"`.
  await startSiteRead(organizationId, website);
  // Fills the assistant once, in the background; it never delays or fails the save.
  void fillAssistantIfEmpty(organizationId);
  return boardFor(organizationId, saved);
}

/** Questions that documents should answer and have no usable result yet. */
export function needsCheck(question: SetupQuestion, site: SiteReading): boolean {
  if (question.needs) return false;
  const check = question.check;
  if (!check || check.outcome === "failed") return true;
  if (check.outcome === "answered") return false;
  // Not answered earlier: look again once the site has been re-read since.
  return (
    site.state.state !== "reading" &&
    !!site.syncedAt &&
    new Date(check.checkedAt).getTime() < new Date(site.syncedAt).getTime()
  );
}

/** One in-flight check per question, so overlapping polls don't pay for the same answer twice. */
const inFlight = new Map<string, Promise<SetupCheckResult>>();

function checkOnce(organizationId: string, question: SetupQuestion): Promise<SetupCheckResult> {
  const key = `${organizationId}:${question.id}:${question.text}`;
  const running = inFlight.get(key);
  if (running) return running;
  const started = checkQuestion(organizationId, question.text).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

/** Writes results onto the freshly read settings, skipping questions removed or reworded meanwhile. */
async function saveChecks(
  organizationId: string,
  results: { id: string; text: string; result: SetupCheckResult }[],
): Promise<SetupSettings> {
  return updateSetup(organizationId, (current) => {
    return {
      ...current,
      questions: current.questions.map((q) => {
        const hit = results.find((r) => r.id === q.id && r.text === q.text);
        return hit ? { ...q, check: hit.result } : q;
      }),
    };
  });
}

export async function checkQuestions(
  organizationId: string,
  questionIds?: string[],
): Promise<SetupBoard> {
  const setup = await readSetup(organizationId);
  const site = await readSiteState(organizationId, setup.website);

  const targets = setup.questions.filter((q) =>
    questionIds ? !q.needs && questionIds.includes(q.id) : needsCheck(q, site),
  );
  if (targets.length === 0) {
    return finishIfReady(organizationId, buildBoard(await loadFacts(organizationId, setup, site)));
  }

  const results = await mapWithConcurrency(targets, CHECK_CONCURRENCY, async (q) => ({
    id: q.id,
    text: q.text,
    result: await checkOnce(organizationId, q),
  }));
  const saved = await saveChecks(organizationId, results);
  return finishIfReady(organizationId, buildBoard(await loadFacts(organizationId, saved, site)));
}

function findQuestion(setup: SetupSettings, questionId: string): SetupQuestion {
  const question = setup.questions.find((q) => q.id === questionId);
  if (!question) throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
  return question;
}

export async function addAnswer(
  organizationId: string,
  questionId: string,
  answer: string,
): Promise<SetupBoard> {
  const question = findQuestion(await readSetup(organizationId), questionId);
  if (question.needs) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This question is answered by a connected platform, not by a document",
    });
  }

  const document = await saveAnswerDocument(organizationId, question.text, answer);
  const rechecked = await checkOnce(organizationId, question);

  // The customer just wrote the answer to this exact question and it is embedded, so a "not
  // answered" verdict would be wrong: record their own text. A failed check stays failed.
  const result: SetupCheckResult =
    rechecked.outcome === "not_answered"
      ? {
          outcome: "answered",
          answer,
          sources: [{ documentId: document.id, title: document.title }],
          checkedAt: rechecked.checkedAt,
        }
      : rechecked;

  const saved = await saveChecks(organizationId, [
    { id: question.id, text: question.text, result },
  ]);
  return boardFor(organizationId, saved);
}

export async function addQuestion(organizationId: string, text: string): Promise<SetupBoard> {
  const trimmed = text.trim();
  let added: SetupQuestion | undefined;

  const saved = await updateSetup(organizationId, (current) => {
    const same = current.questions.find((q) => q.text.toLowerCase() === trimmed.toLowerCase());
    if (same) return current;
    if (current.questions.length >= MAX_QUESTIONS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You can have up to ${MAX_QUESTIONS} questions`,
      });
    }
    added = { id: `custom.${randomUUID()}`, text: trimmed, source: "custom" };
    return { ...current, questions: [...current.questions, added] };
  });

  // One question is cheap to check now, so the row doesn't sit on "checking".
  if (added) {
    const result = await checkOnce(organizationId, added);
    const withCheck = await saveChecks(organizationId, [
      { id: added.id, text: added.text, result },
    ]);
    return boardFor(organizationId, withCheck);
  }
  return boardFor(organizationId, saved);
}

export async function removeQuestion(
  organizationId: string,
  questionId: string,
): Promise<SetupBoard> {
  const saved = await updateSetup(organizationId, (current) => ({
    ...current,
    questions: current.questions.filter((q) => q.id !== questionId),
  }));
  return boardFor(organizationId, saved);
}

export async function dismiss(organizationId: string): Promise<SetupBoard> {
  const saved = await updateSetup(organizationId, (current) => ({
    ...current,
    dismissedAt: new Date().toISOString(),
  }));
  return boardFor(organizationId, saved);
}

/**
 * Drafts playbooks for connected platform requests that have none. Omit `questionIds` for the
 * automatic run; naming ids also retries a request whose earlier attempt found no tool or failed.
 */
export async function generatePlaybooks(
  organizationId: string,
  questionIds?: string[],
): Promise<SetupBoard> {
  const setup = await readSetup(organizationId);
  const plugins = await boardPlugins(organizationId, setup);
  await generatePlaybooksFor(
    organizationId,
    (need) => pluginFor(need, setup, plugins),
    questionIds,
  );
  return boardFor(organizationId);
}

export async function turnOn(
  organizationId: string,
  userId: string,
  questionId: string,
): Promise<SetupBoard> {
  const setup = await readSetup(organizationId);
  await turnOnPlaybook(organizationId, userId, findQuestion(setup, questionId));
  return boardFor(organizationId);
}
