/**
 * In-app setup: reads and writes the board for one organization.
 *
 * Stored answers live in `settings.setup`; row statuses are worked out on every read from the
 * site's sync state, documents and playbooks (see board.ts). Only `checkQuestions`,
 * `updateQuestion` and `addQuestion` call a model, and run a real test turn for answers the check finds.
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
  type SetupAnswerText,
  type SetupBoard,
  type SetupChannelRef,
  type SetupCheckResult,
  type SetupDocumentRef,
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
import {
  CHECK_CONCURRENCY,
  checkQuestion,
  draftAnswerFromDocuments,
  loadOwnAnswers,
  mapWithConcurrency,
  preferOwnAnswer,
} from "./check";
import { answerTextOf } from "./answer-text";
import { retitleAnswerDocument, saveAnswerDocument } from "./answer-document";
import { documentRepository } from "@server/repositories/document.repository";
import { readTurn, startTurns } from "./turn";
import type { PendingTurn, TurnOutcome } from "./turn-classify";
import { createLogger } from "@server/lib/logger";
import { inferBusinessType as inferFromSite, addScheme } from "./infer";
import { readSiteState, startSiteRead, type SiteReading } from "./site";
import { readSetup, updateSetup } from "./store";

export const MAX_QUESTIONS = 30;

const logger = createLogger("setup-service");

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

const webchatName = (language?: string) =>
  catalogLocale(language) === "pt-BR" ? "Chat no site" : "Website chat";

/** The channels the customer picked, resolved to names and whether they are really connected. */
async function loadChannels(
  organizationId: string,
  setup: SetupSettings,
): Promise<SetupChannelRef[]> {
  if (setup.channels.length === 0) return [];
  const language = await organizationLanguage(organizationId);
  const plugins = visiblePlugins(organizationId);
  const pluginFor = (id: string) => plugins.find((p) => p.manifest?.channel === id);
  const connected = await connectedPluginIds(
    organizationId,
    setup.channels.flatMap((id) => pluginFor(id)?.pluginId ?? []),
    { needsTools: false },
  );

  const refs: SetupChannelRef[] = [];
  for (const id of setup.channels) {
    if (id === "webchat") {
      refs.push({ id, name: webchatName(language), connected: true });
      continue;
    }
    // A channel whose plugin is gone (or hidden from this org) is dropped, not shown broken.
    const plugin = pluginFor(id);
    if (!plugin) continue;
    refs.push({
      id,
      name: plugin.name,
      plugin: { id: plugin.pluginId, name: plugin.name },
      connected: connected.has(plugin.pluginId),
    });
  }
  return refs;
}

async function loadFacts(
  organizationId: string,
  setup: SetupSettings,
  options: { site?: SiteReading; resume?: boolean } = {},
) {
  const [siteReading, playbooks, real, plugins, channels] = await Promise.all([
    options.site ?? readSiteState(organizationId, setup.website, { resume: options.resume }),
    loadPlaybooks(setup),
    hasRealConversations(organizationId),
    boardPlugins(organizationId, setup),
    loadChannels(organizationId, setup),
  ]);
  const facts: BoardFacts = {
    setup,
    site: siteReading,
    plugins,
    playbooks,
    hasRealConversations: real,
    channels,
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

async function boardFor(
  organizationId: string,
  setup?: SetupSettings,
  options: { resume?: boolean } = {},
): Promise<SetupBoard> {
  const current = setup ?? (await readSetup(organizationId));
  return finishIfReady(
    organizationId,
    buildBoard(await loadFacts(organizationId, current, options)),
  );
}

/**
 * Reading the board also continues a partial website read that is waiting (see site.ts), but
 * only while setup is still open, so finished accounts never start background work from here.
 */
export async function getBoard(organizationId: string): Promise<SetupBoard> {
  const current = await settleTurns(organizationId, await readSetup(organizationId));
  return boardFor(organizationId, current, { resume: !current.finishedAt && !!current.website });
}

export async function getSuggestions(
  organizationId: string,
  businessType: BusinessType,
): Promise<SetupSuggestions> {
  const language = await organizationLanguage(organizationId);
  const plugins = visiblePlugins(organizationId);

  const channels = new Map<string, string>([["webchat", webchatName(language)]]);
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

/**
 * Starts reading the site while the first question is still open. Saves the address, reuses the
 * org's source for it or creates one, and returns the board. Safe to call again for the same
 * address, and a bad address never throws: it shows up as `site.state === "failed"`.
 */
export async function startReading(organizationId: string, website: string): Promise<SetupBoard> {
  const address = addScheme(website.trim());
  const saved = await updateSetup(organizationId, (current) =>
    current.website === address ? current : { ...current, website: address },
  );
  await startSiteRead(organizationId, address);
  return boardFor(organizationId, saved, { resume: true });
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
  return boardFor(organizationId, saved, { resume: true });
}

/** Questions that documents should answer and have no usable result yet. */
export function needsCheck(question: SetupQuestion, site: SiteReading): boolean {
  if (question.needs) return false;
  const check = question.check;
  if (!check || check.outcome === "failed") return true;
  // A turn that is pending is already being tested. An answer with no turn at all was stored
  // before turns existed: it never passed a real one, so it is checked again.
  if (check.outcome === "answered") return check.turn === undefined;
  // Not answered earlier: look again once the site has been re-read since.
  return (
    site.state.state !== "reading" &&
    !!site.syncedAt &&
    new Date(check.checkedAt).getTime() < new Date(site.syncedAt).getTime()
  );
}

/**
 * One check at a time per organization: a second call (a poll, an added question) waits, then
 * reads the questions again and sees the turns the first one started instead of starting its own.
 */
const checkLocks = new Map<string, Promise<unknown>>();

function serialized<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
  const prior = checkLocks.get(organizationId) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  checkLocks.set(organizationId, next);
  void next
    .finally(() => {
      if (checkLocks.get(organizationId) === next) checkLocks.delete(organizationId);
    })
    .catch(() => undefined);
  return next;
}

interface CheckedQuestion {
  id: string;
  text: string;
  result: SetupCheckResult;
}

/**
 * Starts the real test turns for the questions the cheap check called answered, in one run. They
 * stay `checking` on the board until a turn finishes. If the run cannot start they are `failed`
 * (never missing), so a row is never stuck.
 */
async function withTurns(
  organizationId: string,
  checked: CheckedQuestion[],
): Promise<CheckedQuestion[]> {
  const answered = checked.filter((c) => c.result.outcome === "answered");
  if (answered.length === 0) return checked;
  let started: Map<string, PendingTurn>;
  try {
    started = await startTurns(organizationId, answered);
  } catch (err) {
    logger.warn({ err, organizationId }, "Could not start the setup test turns");
    return checked.map((c) =>
      answered.includes(c)
        ? { ...c, result: { outcome: "failed", sources: [], checkedAt: c.result.checkedAt } }
        : c,
    );
  }
  return checked.map((c) => {
    const turn = started.get(c.id);
    return turn ? { ...c, result: { ...c.result, turn } } : c;
  });
}

function finishTurn(check: SetupCheckResult, outcome: TurnOutcome): SetupCheckResult {
  if (outcome === "passed") return { ...check, turn: { state: "passed" } };
  if (outcome === "handed_off") {
    return { outcome: "not_answered", sources: [], checkedAt: check.checkedAt, handedOff: true };
  }
  return { outcome: "failed", sources: [], checkedAt: new Date().toISOString() };
}

/**
 * Applies the turns that finished (or were lost) since the last read, so a board read or a
 * recheck always recovers a row left on `checking`. Costs nothing when no turn is pending.
 */
async function settleTurns(organizationId: string, setup: SetupSettings): Promise<SetupSettings> {
  const pending = setup.questions.flatMap((q) =>
    q.check?.turn?.state === "pending" ? [{ question: q, turn: q.check.turn }] : [],
  );
  if (pending.length === 0) return setup;

  const outcomes = await Promise.all(
    pending.map(async (p) => ({ ...p, outcome: await readTurn(organizationId, p.turn) })),
  );
  const done = outcomes.filter((o) => o.outcome !== "pending");
  if (done.length === 0) return setup;

  return updateSetup(organizationId, (current) => ({
    ...current,
    questions: current.questions.map((q) => {
      // Same id AND wording AND the same run: a reworded or re-tested question keeps its newer state.
      const hit = done.find((d) => d.question.id === q.id && d.question.text === q.text);
      const turn = q.check?.turn;
      if (!hit || !q.check || turn?.state !== "pending" || turn.runId !== hit.turn.runId) return q;
      return { ...q, check: finishTurn(q.check, hit.outcome) };
    }),
  }));
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
  results: CheckedQuestion[],
): Promise<SetupSettings> {
  return updateSetup(organizationId, (current) => {
    return {
      ...current,
      questions: current.questions.map((q) => {
        const hit = results.find((r) => r.id === q.id && r.text === q.text);
        if (!hit) return q;
        return { ...q, check: hit.result };
      }),
    };
  });
}

/**
 * Cheap check for each target, then one real test turn for those it calls answered. Every
 * recheck goes through here, so a question's own answer wins on every path.
 */
async function checkAndStart(
  organizationId: string,
  targets: SetupQuestion[],
): Promise<SetupSettings> {
  const own = await loadOwnAnswers(organizationId, targets);
  const checked = await mapWithConcurrency(targets, CHECK_CONCURRENCY, async (q) => ({
    id: q.id,
    text: q.text,
    result: preferOwnAnswer(await checkOnce(organizationId, q), own.get(q.id)),
  }));
  return saveChecks(organizationId, await withTurns(organizationId, checked));
}

export function checkQuestions(
  organizationId: string,
  questionIds?: string[],
): Promise<SetupBoard> {
  return serialized(organizationId, async () => {
    const setup = await settleTurns(organizationId, await readSetup(organizationId));
    const site = await readSiteState(organizationId, setup.website);

    const targets = setup.questions.filter((q) =>
      questionIds ? !q.needs && questionIds.includes(q.id) : needsCheck(q, site),
    );
    // A question whose turn is still running is not tested a second time.
    const fresh = targets.filter((q) => q.check?.turn?.state !== "pending");
    // The board always carries the site as it is when we answer, not as it was before the checks
    // ran, so the dashboard never sees "reading" again for a read that has finished.
    if (fresh.length === 0) {
      return finishIfReady(organizationId, buildBoard(await loadFacts(organizationId, setup)));
    }

    const saved = await checkAndStart(organizationId, fresh);
    return finishIfReady(organizationId, buildBoard(await loadFacts(organizationId, saved)));
  });
}

function findQuestion(setup: SetupSettings, questionId: string): SetupQuestion {
  const question = setup.questions.find((q) => q.id === questionId);
  if (!question) throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
  return question;
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

  // The filter is quick; the test turn runs behind it and the row reads "checking" until it ends.
  if (added) {
    const target = added;
    return serialized(organizationId, async () =>
      boardFor(organizationId, await checkAndStart(organizationId, [target])),
    );
  }
  return boardFor(organizationId, saved);
}

const MAX_REMOVED = 5;

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function removeQuestion(
  organizationId: string,
  questionId: string,
): Promise<SetupBoard> {
  const saved = await updateSetup(organizationId, (current) => {
    const index = current.questions.findIndex((q) => q.id === questionId);
    if (index === -1) return current;
    return {
      ...current,
      questions: current.questions.filter((q) => q.id !== questionId),
      recentlyRemoved: [
        { question: current.questions[index], index },
        ...(current.recentlyRemoved ?? []),
      ].slice(0, MAX_REMOVED),
    };
  });
  return boardFor(organizationId, saved);
}

/** Undoes a removal: same position, status, answer and playbook, with no recheck. */
export async function restoreQuestion(
  organizationId: string,
  questionId: string,
): Promise<SetupBoard> {
  const saved = await updateSetup(organizationId, (current) => {
    const removed = (current.recentlyRemoved ?? []).find((r) => r.question.id === questionId);
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Nothing to restore" });
    if (current.questions.length >= MAX_QUESTIONS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You can have up to ${MAX_QUESTIONS} questions`,
      });
    }
    if (current.questions.some((q) => sameText(q.text, removed.question.text))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A question with this text already exists",
      });
    }
    const questions = [...current.questions];
    questions.splice(Math.min(removed.index, questions.length), 0, removed.question);
    return {
      ...current,
      questions,
      recentlyRemoved: (current.recentlyRemoved ?? []).filter((r) => r.question.id !== questionId),
    };
  });
  return boardFor(organizationId, saved);
}

export interface UpdateQuestionInput {
  questionId: string;
  text?: string;
  answer?: string;
  /** The documents the answer is based on, replacing the current list. Empty drops every link. */
  linkedDocumentIds?: string[];
}

/**
 * Saves a row's edit panel in one go: wording, own answer and the documents it is based on, then
 * one recheck. The document is written first so the check sees its new embedding.
 */
export async function updateQuestion(
  organizationId: string,
  input: UpdateQuestionInput,
): Promise<SetupBoard> {
  const setup = await readSetup(organizationId);
  const question = findQuestion(setup, input.questionId);
  const { answer, linkedDocumentIds } = input;

  if (question.needs && (answer !== undefined || linkedDocumentIds !== undefined)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This question is answered by a connected platform, not by a document",
    });
  }

  const text = input.text?.trim() ?? question.text;
  const renamed = text !== question.text;
  if (!renamed && answer === undefined && linkedDocumentIds === undefined) {
    return boardFor(organizationId, setup);
  }
  if (renamed && setup.questions.some((q) => q.id !== question.id && sameText(q.text, text))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A question with this text already exists",
    });
  }

  let linked: SetupDocumentRef[] | undefined;
  if (linkedDocumentIds !== undefined) {
    const ids = [...new Set(linkedDocumentIds)];
    if (question.answerDocumentId && ids.includes(question.answerDocumentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Link a different document" });
    }
    linked = [];
    for (const id of ids) {
      const document = await documentRepository.findByIdAndOrganization(id, organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      linked.push({ id: document.id, title: document.title });
    }
  }

  const own = question.answerDocumentId
    ? await documentRepository.findByIdAndOrganization(question.answerDocumentId, organizationId)
    : null;
  // A title the customer never changed follows the question; one they changed is theirs.
  const followsQuestion = !!own && own.title === question.text;
  const title = own && !followsQuestion ? own.title : text;

  let answerDocumentId = question.answerDocumentId;
  if (answer !== undefined) {
    answerDocumentId = (
      await saveAnswerDocument(organizationId, { existing: own, title, text: answer })
    ).id;
  } else if (own && renamed && followsQuestion) {
    await retitleAnswerDocument(organizationId, own, text);
  }

  const saved = await updateSetup(organizationId, (current) => ({
    ...current,
    questions: current.questions.map((q) => {
      if (q.id !== question.id) return q;
      return {
        ...q,
        text,
        check: undefined,
        answerDocumentId,
        linkedDocuments:
          linked === undefined ? q.linkedDocuments : linked.length ? linked : undefined,
      };
    }),
  }));

  if (question.needs) return boardFor(organizationId, saved);

  return serialized(organizationId, async () => {
    const latest = await readSetup(organizationId);
    const target = latest.questions.find((q) => q.id === question.id);
    if (!target || target.text !== text) return boardFor(organizationId, latest);
    return boardFor(organizationId, await checkAndStart(organizationId, [target]));
  });
}

export async function draftAnswer(
  organizationId: string,
  questionId: string,
  documentIds: string[],
): Promise<{ answer: string | null }> {
  const question = findQuestion(await readSetup(organizationId), questionId);
  return { answer: await draftAnswerFromDocuments(organizationId, question.text, documentIds) };
}

/** The text of a row's own answer, or null when it has none or its document is gone. */
export async function getAnswer(
  organizationId: string,
  questionId: string,
): Promise<SetupAnswerText | null> {
  const { answerDocumentId } = findQuestion(await readSetup(organizationId), questionId);
  if (!answerDocumentId) return null;
  const document = await documentRepository.findByIdAndOrganization(
    answerDocumentId,
    organizationId,
  );
  return document ? answerTextOf(document.content) : null;
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
