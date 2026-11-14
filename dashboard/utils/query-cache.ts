import { shallowReactive } from "vue";

/**
 * In-memory store behind useCachedQuery. Holds conversation and customer data,
 * so it must stay in memory: never persist an entry to localStorage,
 * sessionStorage or IndexedDB.
 *
 * Holds one user + organization at a time. Moving to another scope drops every
 * entry, and responses still in flight for the old scope are thrown away.
 */

/** The first element is the group that mutations invalidate (see MUTATION_GROUPS). */
export type QueryKey = readonly [string, ...unknown[]];

export interface QueryEntry<T = unknown> {
  readonly hash: string;
  readonly group: string;
  data: T | undefined;
  /** Time of the last successful response; 0 when invalidated. */
  updatedAt: number;
  error: unknown;
  /** A request is running, or an invalidation is about to start one. */
  fetching: boolean;
  /** Mounted users of this entry. Entries nobody shows can be evicted. */
  subscribers: number;
  fetcher: (() => Promise<T>) | null;
  inFlight: Promise<void> | null;
  /** Bumped to orphan a running request: its response is then discarded. */
  generation: number;
  /** A refresh arrived during a request, so run another when it finishes. */
  rerun: boolean;
  /** Local changes made during a request, replayed on top of its response. */
  patches: Array<(data: T) => T>;
}

/** Longest a list may sit unseen and still be shown from cache. */
export const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;
/** Serial mutations (bulk delete) cause one refetch, not one per item. */
const INVALIDATION_DEBOUNCE_MS = 150;

/**
 * Which cached groups a successful mutation can change, by tRPC router. This
 * sits in the tRPC client so a new mutation cannot forget to invalidate.
 */
const MUTATION_GROUPS: Record<string, string[]> = {
  conversations: ["conversations", "analytics"],
  actions: ["conversations", "analytics"],
  documents: ["documents", "analytics"],
  playbooks: ["playbooks"],
  customers: ["customers"],
  insights: ["documents", "playbooks"],
  // Placing a document in a help center collection makes it public.
  helpCenter: ["documents"],
};

/** Mutations under those routers that do not change what any cached list shows. */
const MUTATIONS_WITHOUT_LIST_EFFECT = new Set([
  "conversations.sendMessage",
  "conversations.uploadAttachment",
  "conversations.sendChannelTemplate",
  "conversations.forwardProductCase",
  "conversations.setLegalHold",
  "conversations.setDryRun",
  "documents.uploadImage",
  "documents.suggestEdits",
  "playbooks.generateInstructions",
  "playbooks.suggestEdits",
]);

const entries = new Map<string, QueryEntry>();
const awaitingRefetch = new Set<QueryEntry>();
let activeScope: string | null = null;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;

/** Orphan a running request so its response cannot land. */
function detachRequest(entry: QueryEntry) {
  entry.generation++;
  entry.inFlight = null;
  entry.rerun = false;
  entry.patches = [];
}

function evictOldest() {
  for (const [hash, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) return;
    if (entry.subscribers === 0 && !entry.inFlight) entries.delete(hash);
  }
}

/** Forget everything: logout, or the active user or organization changed. */
export function clearQueryCache() {
  for (const entry of entries.values()) {
    detachRequest(entry);
    // A component may still hold this object until it re-renders.
    entry.data = undefined;
    entry.error = undefined;
    entry.fetching = false;
    entry.updatedAt = 0;
  }
  entries.clear();
  awaitingRefetch.clear();
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = null;
}

/** The entry for a key in this scope, created on first use. Reading refreshes its LRU slot. */
export function getQueryEntry<T>(scope: string, key: QueryKey): QueryEntry<T> {
  if (scope !== activeScope) {
    clearQueryCache();
    activeScope = scope;
  }

  const hash = JSON.stringify(key);
  let entry = entries.get(hash) as QueryEntry<T> | undefined;
  if (entry) {
    entries.delete(hash);
  } else {
    entry = shallowReactive<QueryEntry<T>>({
      hash,
      group: key[0],
      data: undefined,
      updatedAt: 0,
      error: undefined,
      fetching: false,
      subscribers: 0,
      fetcher: null,
      inFlight: null,
      generation: 0,
      rerun: false,
      patches: [],
    }) as QueryEntry<T>;
  }
  entries.set(hash, entry as QueryEntry);
  evictOldest();
  return entry;
}

function startRequest<T>(entry: QueryEntry<T>): Promise<void> {
  const generation = entry.generation;
  const fetcher = entry.fetcher;
  if (!fetcher) return Promise.resolve();

  entry.fetching = true;
  if (entry.data === undefined) entry.error = undefined;

  const request = (async () => {
    let result: T;
    try {
      result = await fetcher();
    } catch (error) {
      if (entry.generation !== generation) return;
      // Cached data stays on screen; pages decide whether to surface the error.
      console.error(`[QueryCache] ${entry.hash} failed:`, error);
      entry.error = error;
      finishRequest(entry);
      return;
    }
    if (entry.generation !== generation) return;
    entry.data = entry.patches.reduce((data, patch) => patch(data), result);
    entry.updatedAt = Date.now();
    entry.error = undefined;
    finishRequest(entry);
  })();

  entry.inFlight = request;
  return request;
}

function finishRequest<T>(entry: QueryEntry<T>) {
  entry.inFlight = null;
  entry.patches = [];
  if (entry.rerun) {
    entry.rerun = false;
    void startRequest(entry);
  } else {
    entry.fetching = false;
  }
}

/** Fetch unless a request is already running: identical concurrent callers share one. */
export function revalidateEntry<T>(entry: QueryEntry<T>): Promise<void> {
  return entry.inFlight ?? startRequest(entry);
}

/**
 * Fetch data that is known to have changed (user refresh, live event). A running
 * request may predate the change, so another follows it. At most one runs and
 * one waits, however many events arrive.
 */
export function refreshEntry<T>(entry: QueryEntry<T>): Promise<void> {
  if (entry.inFlight) {
    entry.rerun = true;
    return entry.inFlight;
  }
  return startRequest(entry);
}

/**
 * Change cached data locally (a live event, a page's own update). Also applied
 * to the response of a request already running, which may predate the change,
 * so updaters must be safe to run twice.
 */
export function patchEntry<T>(entry: QueryEntry<T>, updater: (data: T) => T) {
  if (entry.data === undefined) return;
  entry.data = updater(entry.data);
  if (entry.inFlight) entry.patches.push(updater);
}

/** A list no-one has looked at for a long time is not worth showing. */
export function dropIfExpired<T>(entry: QueryEntry<T>, now = Date.now()) {
  if (entry.data !== undefined && entry.updatedAt > 0 && now - entry.updatedAt > MAX_AGE_MS) {
    entry.data = undefined;
    entry.updatedAt = 0;
  }
}

function flushRefetches() {
  refetchTimer = null;
  const pending = [...awaitingRefetch];
  awaitingRefetch.clear();
  for (const entry of pending) {
    if (entries.get(entry.hash) !== entry) continue;
    if (entry.subscribers === 0) {
      entries.delete(entry.hash);
    } else if (!entry.inFlight) {
      void startRequest(entry);
    }
  }
}

/**
 * Data in these groups changed on the server. Running requests may have read
 * the old state, so their responses are discarded. Mounted entries keep showing
 * their data and refetch; the rest are dropped, because reopening a page must
 * not show a list that contradicts what the user just did.
 */
export function invalidateQueries(groups: readonly string[]) {
  for (const entry of [...entries.values()]) {
    if (!groups.includes(entry.group)) continue;
    detachRequest(entry);
    if (entry.subscribers === 0) {
      entries.delete(entry.hash);
      entry.fetching = false;
      continue;
    }
    entry.updatedAt = 0;
    entry.fetching = true;
    awaitingRefetch.add(entry);
  }
  if (awaitingRefetch.size > 0) {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(flushRefetches, INVALIDATION_DEBOUNCE_MS);
  }
}

/** Called by the tRPC client after a mutation succeeds. */
export function invalidateForMutation(path: string) {
  if (MUTATIONS_WITHOUT_LIST_EFFECT.has(path)) return;
  const groups = MUTATION_GROUPS[path.split(".")[0]];
  if (groups) invalidateQueries(groups);
}
