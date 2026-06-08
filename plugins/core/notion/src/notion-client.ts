/**
 * Notion API client.
 *
 * Uses Node 20+ built-in fetch. Auth is a single internal-integration token
 * (Bearer). The integration only sees pages/databases that a workspace member
 * has explicitly shared with it — that sharing is the scope boundary for import.
 *
 * Retry policy (mirrors the Confluence client — the best HTTP-client pattern in
 * the repo):
 *   - 429: honor Retry-After header (seconds), up to 5 retries
 *   - 5xx: exponential backoff 1s, 2s, 4s, up to 3 retries
 *   - 4xx (non-429): throw immediately with endpoint + status + truncated body
 *
 * Errors are thrown as `Error` with a message prefixed `Notion <status> ...` so
 * the router can map 401/403 → UNAUTHORIZED.
 */

const DEFAULT_NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com/v1";

const RATE_LIMIT_MAX_RETRIES = 5;
const SERVER_ERROR_MAX_RETRIES = 3;
const SERVER_ERROR_BACKOFFS_MS = [1000, 2000, 4000];

/** Guard rails for recursive block fetching so a pathological page can't hang a sync. */
const MAX_BLOCK_DEPTH = 6;
const MAX_BLOCKS_PER_PAGE = 4000;

// ---------------------------------------------------------------------------
// Wire types (only the fields we actually read)
// ---------------------------------------------------------------------------

export interface NotionAnnotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
}

export interface NotionRichText {
  plain_text?: string;
  href?: string | null;
  annotations?: NotionAnnotations;
  equation?: { expression?: string };
}

export interface NotionParent {
  type?: string;
  database_id?: string;
  page_id?: string;
  workspace?: boolean;
}

export interface NotionPage {
  object: "page";
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: NotionParent;
  properties?: Record<string, NotionProperty>;
}

export interface NotionProperty {
  id?: string;
  type?: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
}

export interface NotionDatabase {
  object: "database";
  id: string;
  url?: string;
  last_edited_time?: string;
  title?: NotionRichText[];
  parent?: NotionParent;
}

/** A block with its descendants eagerly fetched into `children`. */
export interface NotionBlock {
  object: "block";
  id: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  children?: NotionBlock[];
  // The per-type payload lives under a key equal to `type` (e.g. block.paragraph).
  [key: string]: unknown;
}

interface NotionList<T> {
  results: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, n = 500): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `...[truncated ${s.length - n} chars]`;
}

/** Flatten a Notion rich-text array to its plain-text content. */
export function richTextToPlain(rt?: NotionRichText[]): string {
  if (!Array.isArray(rt)) return "";
  return rt.map((t) => t.plain_text ?? "").join("");
}

/**
 * Extract a human title from a page's properties. Database rows put the title
 * under an arbitrarily-named property whose `type` is "title"; standalone pages
 * use a property literally named "title". We scan for the title-typed one.
 */
export function pageTitle(page: NotionPage): string {
  const props = page.properties ?? {};
  for (const value of Object.values(props)) {
    if (value?.type === "title") {
      const title = richTextToPlain(value.title);
      if (title.trim().length > 0) return title;
    }
  }
  return "Untitled";
}

export class NotionClient {
  private readonly token: string;
  private readonly version: string;

  constructor(token: string, version?: string) {
    if (!token) {
      throw new Error("NotionClient: an integration token is required");
    }
    this.token = token;
    this.version = version && version.trim().length > 0 ? version : DEFAULT_NOTION_VERSION;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Notion-Version": this.version,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  /**
   * Perform a request against `path` (relative to /v1) with the retry policy
   * applied. Returns parsed JSON.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    const url = this.buildUrl(path, opts?.query);
    const init: RequestInit = { method, headers: this.headers() };
    if (opts?.body !== undefined) {
      init.body = JSON.stringify(opts.body);
    }

    let rateLimitAttempts = 0;
    let serverErrorAttempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        // Network-level failures — treat like a 5xx retry path.
        if (serverErrorAttempts >= SERVER_ERROR_MAX_RETRIES) {
          throw new Error(`Notion request failed (network): ${url} - ${(err as Error).message}`);
        }
        const backoff = SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts];
        serverErrorAttempts += 1;
        await sleep(backoff);
        continue;
      }

      if (response.ok) {
        const text = await response.text();
        if (text.length === 0) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch (err) {
          throw new Error(
            `Notion response JSON parse failed for ${url}: ${(err as Error).message}; body=${truncate(text)}`,
          );
        }
      }

      // 429 — honor Retry-After.
      if (response.status === 429) {
        if (rateLimitAttempts >= RATE_LIMIT_MAX_RETRIES) {
          const body = await this.readBodySafe(response);
          throw new Error(
            `Notion 429 rate limit exceeded after ${RATE_LIMIT_MAX_RETRIES} retries (${url}): ${truncate(body)}`,
          );
        }
        const retryAfter = parseFloat(response.headers.get("retry-after") ?? "1");
        const waitMs = Math.max(0, isFinite(retryAfter) ? retryAfter * 1000 : 1000);
        rateLimitAttempts += 1;
        await sleep(waitMs);
        continue;
      }

      // 5xx — exponential backoff.
      if (response.status >= 500 && response.status <= 599) {
        if (serverErrorAttempts >= SERVER_ERROR_MAX_RETRIES) {
          const body = await this.readBodySafe(response);
          throw new Error(
            `Notion ${response.status} after ${SERVER_ERROR_MAX_RETRIES} retries (${url}): ${truncate(body)}`,
          );
        }
        const backoff = SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts];
        serverErrorAttempts += 1;
        await sleep(backoff);
        continue;
      }

      // Other 4xx — throw immediately.
      const body = await this.readBodySafe(response);
      throw new Error(
        `Notion ${response.status} ${response.statusText} for ${url}: ${truncate(body)}`,
      );
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${API_BASE}${p}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async readBodySafe(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "<unreadable body>";
    }
  }

  /**
   * POST /search restricted to `object` — pages or databases. Optionally sorted
   * by last_edited_time (used by the incremental delta path).
   */
  async search(opts: {
    object: "page" | "database";
    sortDescending?: boolean;
    cursor?: string;
    pageSize?: number;
  }): Promise<{ results: Array<NotionPage | NotionDatabase>; nextCursor?: string }> {
    const body: Record<string, unknown> = {
      filter: { value: opts.object, property: "object" },
      page_size: opts.pageSize ?? 100,
    };
    if (opts.cursor) body.start_cursor = opts.cursor;
    if (opts.sortDescending) {
      body.sort = { direction: "descending", timestamp: "last_edited_time" };
    }
    const data = await this.request<NotionList<NotionPage | NotionDatabase>>("POST", "/search", {
      body,
    });
    return {
      results: data.results ?? [],
      nextCursor: data.has_more ? (data.next_cursor ?? undefined) : undefined,
    };
  }

  /** POST /databases/{id}/query — paginated, optionally sorted by last_edited_time. */
  async queryDatabase(opts: {
    databaseId: string;
    sortDescending?: boolean;
    cursor?: string;
    pageSize?: number;
  }): Promise<{ results: NotionPage[]; nextCursor?: string }> {
    const body: Record<string, unknown> = { page_size: opts.pageSize ?? 100 };
    if (opts.cursor) body.start_cursor = opts.cursor;
    if (opts.sortDescending) {
      body.sorts = [{ timestamp: "last_edited_time", direction: "descending" }];
    }
    const data = await this.request<NotionList<NotionPage>>(
      "POST",
      `/databases/${encodeURIComponent(opts.databaseId)}/query`,
      { body },
    );
    return {
      results: data.results ?? [],
      nextCursor: data.has_more ? (data.next_cursor ?? undefined) : undefined,
    };
  }

  /** GET /pages/{id} */
  async getPage(pageId: string): Promise<NotionPage> {
    return this.request<NotionPage>("GET", `/pages/${encodeURIComponent(pageId)}`);
  }

  /** GET /blocks/{id}/children — one page of direct children. */
  private async getBlockChildren(
    blockId: string,
    cursor?: string,
  ): Promise<{ results: NotionBlock[]; nextCursor?: string }> {
    const data = await this.request<NotionList<NotionBlock>>(
      "GET",
      `/blocks/${encodeURIComponent(blockId)}/children`,
      { query: { page_size: 100, start_cursor: cursor } },
    );
    return {
      results: data.results ?? [],
      nextCursor: data.has_more ? (data.next_cursor ?? undefined) : undefined,
    };
  }

  /**
   * Fetch the full block tree under a page (or block), eagerly populating each
   * block's `children`. Bounded by MAX_BLOCK_DEPTH and MAX_BLOCKS_PER_PAGE so a
   * deeply nested or enormous page degrades gracefully instead of hanging.
   */
  async getBlockTree(blockId: string): Promise<NotionBlock[]> {
    const counter = { count: 0 };
    return this.fetchChildrenRecursive(blockId, 0, counter);
  }

  private async fetchChildrenRecursive(
    blockId: string,
    depth: number,
    counter: { count: number },
  ): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | undefined = undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { results, nextCursor } = await this.getBlockChildren(blockId, cursor);
      for (const block of results) {
        if (counter.count >= MAX_BLOCKS_PER_PAGE) return blocks;
        counter.count += 1;
        if (block.has_children && depth < MAX_BLOCK_DEPTH) {
          block.children = await this.fetchChildrenRecursive(block.id, depth + 1, counter);
        }
        blocks.push(block);
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return blocks;
  }

  /** Cheap auth-ping. Returns a shape suitable for connection-test UIs. */
  async ping(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.search({ object: "page", pageSize: 1 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
