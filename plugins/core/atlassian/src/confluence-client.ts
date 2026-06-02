/**
 * Confluence Cloud REST v2 API client.
 *
 * Uses Node 20+ built-in fetch. Supports two auth modes:
 *   - basic: email + API token against a site URL (https://<site>.atlassian.net/wiki/api/v2)
 *   - oauth: 3LO access token + cloud id (https://api.atlassian.com/ex/confluence/<cloudId>/wiki/api/v2)
 *
 * Retry policy:
 *   - 429: honor Retry-After header (seconds), up to 5 retries
 *   - 5xx: exponential backoff 1s, 2s, 4s, up to 3 retries
 *   - 4xx (non-429): throw immediately with endpoint + status + truncated body
 */

export type AuthConfig =
  | { mode: "basic"; email: string; apiToken: string; siteUrl: string }
  | { mode: "oauth"; accessToken: string; cloudId: string };

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: string;
  description?: { plain?: { value: string } };
  _links?: { webui?: string };
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string;
  status: string; // 'current', 'archived', etc.
  parentId?: string;
  version: { number: number; createdAt?: string; modifiedAt?: string; authorId?: string };
  _links?: { webui?: string };
  body?: { atlas_doc_format?: { value: string } };
}

export interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
}

interface PaginatedV2<T> {
  results: T[];
  _links?: { next?: string; base?: string };
}

const RATE_LIMIT_MAX_RETRIES = 5;
const SERVER_ERROR_MAX_RETRIES = 3;
const SERVER_ERROR_BACKOFFS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, n = 500): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `...[truncated ${s.length - n} chars]`;
}

export class ConfluenceClient {
  private readonly auth: AuthConfig;

  constructor(auth: AuthConfig) {
    if (auth.mode === "basic") {
      if (!auth.email || !auth.apiToken || !auth.siteUrl) {
        throw new Error("ConfluenceClient: basic auth requires email, apiToken, siteUrl");
      }
    } else if (auth.mode === "oauth") {
      if (!auth.accessToken || !auth.cloudId) {
        throw new Error("ConfluenceClient: oauth auth requires accessToken and cloudId");
      }
    } else {
      throw new Error("ConfluenceClient: unknown auth mode");
    }
    this.auth = auth;
  }

  /** Returns the API base URL for the configured auth mode. */
  private baseUrl(): string {
    if (this.auth.mode === "basic") {
      // Strip any trailing slash from siteUrl to avoid double slashes
      const site = this.auth.siteUrl.replace(/\/+$/, "");
      return `${site}/wiki/api/v2`;
    }
    return `https://api.atlassian.com/ex/confluence/${this.auth.cloudId}/wiki/api/v2`;
  }

  private authHeader(): string {
    if (this.auth.mode === "basic") {
      const encoded = Buffer.from(`${this.auth.email}:${this.auth.apiToken}`).toString("base64");
      return `Basic ${encoded}`;
    }
    return `Bearer ${this.auth.accessToken}`;
  }

  /**
   * Perform a GET against `path` (relative to base) or a fully-qualified URL,
   * with retry policy applied. Returns parsed JSON.
   */
  private async request<T>(
    pathOrUrl: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(pathOrUrl, query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };

    let rateLimitAttempts = 0;
    let serverErrorAttempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", headers });
      } catch (err) {
        // Network-level failures - treat like a 5xx retry path
        if (serverErrorAttempts >= SERVER_ERROR_MAX_RETRIES) {
          throw new Error(
            `Confluence request failed (network): ${url} - ${(err as Error).message}`,
          );
        }
        const backoff = SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts];
        serverErrorAttempts += 1;
        await sleep(backoff);
        continue;
      }

      if (response.ok) {
        const text = await response.text();
        if (text.length === 0) {
          // Some endpoints can legitimately be empty (rare for GET) - return empty object
          return {} as T;
        }
        try {
          return JSON.parse(text) as T;
        } catch (err) {
          throw new Error(
            `Confluence response JSON parse failed for ${url}: ${(err as Error).message}; body=${truncate(text)}`,
          );
        }
      }

      // 429 - honor Retry-After
      if (response.status === 429) {
        if (rateLimitAttempts >= RATE_LIMIT_MAX_RETRIES) {
          const body = await this.readBodySafe(response);
          throw new Error(
            `Confluence 429 rate limit exceeded after ${RATE_LIMIT_MAX_RETRIES} retries (${url}): ${truncate(body)}`,
          );
        }
        const retryAfter = parseFloat(response.headers.get("retry-after") ?? "1");
        const waitMs = Math.max(0, isFinite(retryAfter) ? retryAfter * 1000 : 1000);
        rateLimitAttempts += 1;
        await sleep(waitMs);
        continue;
      }

      // 5xx - exponential backoff
      if (response.status >= 500 && response.status <= 599) {
        if (serverErrorAttempts >= SERVER_ERROR_MAX_RETRIES) {
          const body = await this.readBodySafe(response);
          throw new Error(
            `Confluence ${response.status} after ${SERVER_ERROR_MAX_RETRIES} retries (${url}): ${truncate(body)}`,
          );
        }
        const backoff = SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts];
        serverErrorAttempts += 1;
        await sleep(backoff);
        continue;
      }

      // Other 4xx - throw immediately
      const body = await this.readBodySafe(response);
      throw new Error(
        `Confluence ${response.status} ${response.statusText} for ${url}: ${truncate(body)}`,
      );
    }
  }

  private buildUrl(pathOrUrl: string, query?: Record<string, string | number | undefined>): string {
    let url: URL;
    if (/^https?:\/\//i.test(pathOrUrl)) {
      url = new URL(pathOrUrl);
    } else if (pathOrUrl.startsWith("/wiki/api/v2")) {
      // Confluence v2 `_links.next` is a relative path like "/wiki/api/v2/pages?cursor=..."
      // For basic auth we resolve against siteUrl; for oauth against api.atlassian.com/ex/confluence/{cloudId}
      if (this.auth.mode === "basic") {
        const site = this.auth.siteUrl.replace(/\/+$/, "");
        url = new URL(`${site}${pathOrUrl}`);
      } else {
        url = new URL(`https://api.atlassian.com/ex/confluence/${this.auth.cloudId}${pathOrUrl}`);
      }
    } else {
      // Relative to the v2 base
      const base = this.baseUrl();
      const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
      url = new URL(`${base}${path}`);
    }

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
   * Extract a cursor value from a relative `_links.next` URL.
   * Confluence v2 returns something like "/wiki/api/v2/pages?cursor=XYZ&limit=25".
   */
  private extractNextCursor(nextLink?: string): string | undefined {
    if (!nextLink) return undefined;
    try {
      // Use a dummy base for parsing relative URLs
      const u = nextLink.startsWith("http")
        ? new URL(nextLink)
        : new URL(nextLink, "https://placeholder.invalid");
      const cursor = u.searchParams.get("cursor");
      return cursor ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** GET /spaces — paginated. */
  async listSpaces(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ results: ConfluenceSpace[]; nextCursor?: string }> {
    const data = await this.request<PaginatedV2<ConfluenceSpace>>("/spaces", {
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return {
      results: data.results ?? [],
      nextCursor: this.extractNextCursor(data._links?.next),
    };
  }

  /**
   * Return the total number of current pages in a space, using the v1 search
   * API (the v2 paginated endpoint does not expose a total). Returns null on
   * failure so the UI can still render the space without a count.
   */
  async countPagesInSpace(spaceKey: string): Promise<number | null> {
    try {
      // v1 search lives under /wiki/rest/api, not /wiki/api/v2. Build the URL
      // by walking back from the v2 base.
      const v2 = this.baseUrl();
      const root = v2.replace(/\/api\/v2$/, "");
      const url = new URL(`${root}/rest/api/search`);
      url.searchParams.set("cql", `space="${spaceKey}" AND type="page"`);
      url.searchParams.set("limit", "0");
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
        },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { totalSize?: number };
      return typeof body.totalSize === "number" ? body.totalSize : null;
    } catch {
      return null;
    }
  }

  /** GET /pages?space-id={id} — paginated. */
  async listPagesInSpace(opts: {
    spaceId: string;
    limit?: number;
    cursor?: string;
    sort?: string;
  }): Promise<{ results: ConfluencePage[]; nextCursor?: string }> {
    const data = await this.request<PaginatedV2<ConfluencePage>>("/pages", {
      "space-id": opts.spaceId,
      "body-format": "atlas_doc_format",
      limit: opts.limit,
      cursor: opts.cursor,
      sort: opts.sort,
    });
    return {
      results: data.results ?? [],
      nextCursor: this.extractNextCursor(data._links?.next),
    };
  }

  /** GET /pages/{id}?body-format=atlas_doc_format */
  async getPage(opts: {
    pageId: string;
  }): Promise<ConfluencePage & { body: { atlas_doc_format?: { value: string } } }> {
    const page = await this.request<
      ConfluencePage & { body: { atlas_doc_format?: { value: string } } }
    >(`/pages/${encodeURIComponent(opts.pageId)}`, { "body-format": "atlas_doc_format" });
    return page;
  }

  /**
   * GET /pages?space-id=&sort=-modified-date — paginated, stops walking once
   * a page is older than sinceISO. Returns only pages with modifiedAt >= sinceISO.
   */
  async listPagesModifiedSince(opts: {
    spaceId: string;
    sinceISO: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ results: ConfluencePage[]; nextCursor?: string }> {
    const sinceMs = Date.parse(opts.sinceISO);
    if (isNaN(sinceMs)) {
      throw new Error(`listPagesModifiedSince: invalid sinceISO "${opts.sinceISO}"`);
    }

    const data = await this.request<PaginatedV2<ConfluencePage>>("/pages", {
      "space-id": opts.spaceId,
      "body-format": "atlas_doc_format",
      sort: "-modified-date",
      limit: opts.limit,
      cursor: opts.cursor,
    });

    const all = data.results ?? [];
    const filtered: ConfluencePage[] = [];
    let truncatedByDate = false;
    for (const page of all) {
      // Confluence Cloud v2 returns version.createdAt (the time the current version was created),
      // not version.modifiedAt — treat either as the effective last-modified timestamp.
      const modifiedAt = page.version?.modifiedAt ?? page.version?.createdAt;
      if (!modifiedAt) {
        // Without a timestamp we can't compare; include conservatively
        filtered.push(page);
        continue;
      }
      const pageMs = Date.parse(modifiedAt);
      if (isNaN(pageMs) || pageMs >= sinceMs) {
        filtered.push(page);
      } else {
        // Since results are sorted by -modified-date, the first time we see a page
        // older than sinceISO we know no later page in this batch is newer either.
        truncatedByDate = true;
        break;
      }
    }

    // If we truncated by date, do NOT return a cursor - caller is done.
    const nextCursor = truncatedByDate ? undefined : this.extractNextCursor(data._links?.next);

    return { results: filtered, nextCursor };
  }

  /**
   * Fetch the list of Atlassian sites accessible to the OAuth access token.
   * Used in the OAuth flow to discover the cloudId.
   */
  static async fetchAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
    const url = "https://api.atlassian.com/oauth/token/accessible-resources";
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      throw new Error(
        `Confluence accessible-resources ${response.status} ${response.statusText}: ${truncate(body)}`,
      );
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as AccessibleResource[];
    } catch (err) {
      throw new Error(
        `Confluence accessible-resources JSON parse failed: ${(err as Error).message}; body=${truncate(text)}`,
      );
    }
  }

  /** Cheap auth-ping. Returns shape suitable for connection-test UIs. */
  async ping(): Promise<{ ok: true; spaceCount: number } | { ok: false; error: string }> {
    try {
      const { results } = await this.listSpaces({ limit: 1 });
      return { ok: true, spaceCount: results.length };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
