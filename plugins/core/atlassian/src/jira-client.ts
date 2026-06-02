/**
 * Jira Cloud REST v3 client.
 *
 * Mirrors the auth shape of ConfluenceClient so a single AuthConfig (API token
 * or OAuth 3LO) can be used for both halves of the Atlassian plugin. Jira's
 * base path lives at `${siteUrl}/rest/api/3` (basic) or
 * `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3` (OAuth).
 */

import type { AuthConfig } from "./confluence-client.js";

// Retry policy for GET reads — mirrors ConfluenceClient so both halves of the
// plugin behave consistently under Atlassian rate limits / transient 5xx.
const RATE_LIMIT_MAX_RETRIES = 5;
const SERVER_ERROR_MAX_RETRIES = 3;
const SERVER_ERROR_BACKOFFS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  simplified?: boolean;
  style?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { name?: string; key?: string } };
    issuetype?: { name?: string; iconUrl?: string };
    priority?: { name?: string };
    assignee?: { accountId?: string; displayName?: string; emailAddress?: string };
    reporter?: { accountId?: string; displayName?: string };
    project?: { key?: string; name?: string };
    created?: string;
    updated?: string;
    duedate?: string | null;
    labels?: string[];
    description?: unknown; // ADF document
    [k: string]: unknown;
  };
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

export class JiraClient {
  constructor(private auth: AuthConfig) {}

  private baseUrl(): string {
    if (this.auth.mode === "basic") {
      const site = this.auth.siteUrl.replace(/\/+$/, "");
      return `${site}/rest/api/3`;
    }
    return `https://api.atlassian.com/ex/jira/${this.auth.cloudId}/rest/api/3`;
  }

  private authHeader(): string {
    if (this.auth.mode === "basic") {
      const encoded = Buffer.from(`${this.auth.email}:${this.auth.apiToken}`).toString("base64");
      return `Basic ${encoded}`;
    }
    return `Bearer ${this.auth.accessToken}`;
  }

  private async request<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl()}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }
    const headers = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };

    let rateLimitAttempts = 0;
    let serverErrorAttempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let res: Response;
      try {
        res = await fetch(url.toString(), { method: "GET", headers });
      } catch (err) {
        // Network-level failure — treat like a 5xx retry path.
        if (serverErrorAttempts >= SERVER_ERROR_MAX_RETRIES) {
          throw new Error(`Jira request failed (network): ${path} - ${(err as Error).message}`);
        }
        await sleep(SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts]);
        serverErrorAttempts += 1;
        continue;
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      // 429 — honor Retry-After.
      if (res.status === 429 && rateLimitAttempts < RATE_LIMIT_MAX_RETRIES) {
        const retryAfter = parseFloat(res.headers.get("retry-after") ?? "1");
        const waitMs = Math.max(0, isFinite(retryAfter) ? retryAfter * 1000 : 1000);
        rateLimitAttempts += 1;
        await sleep(waitMs);
        continue;
      }

      // 5xx — exponential backoff.
      if (
        res.status >= 500 &&
        res.status <= 599 &&
        serverErrorAttempts < SERVER_ERROR_MAX_RETRIES
      ) {
        await sleep(SERVER_ERROR_BACKOFFS_MS[serverErrorAttempts]);
        serverErrorAttempts += 1;
        continue;
      }

      // Other 4xx, or retries exhausted — throw immediately.
      const body = await res.text().catch(() => "");
      throw new Error(`Jira ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 300)}`);
    }
  }

  /** GET /project/search — paginated list of Jira projects. */
  async listProjects(opts?: { limit?: number; startAt?: number }): Promise<{
    values: JiraProject[];
    total: number;
    startAt: number;
    maxResults: number;
    isLast: boolean;
  }> {
    return this.request("/project/search", {
      maxResults: opts?.limit ?? 50,
      startAt: opts?.startAt ?? 0,
    });
  }

  /**
   * Search issues via the new /search/jql endpoint (the legacy /search was
   * removed by Atlassian in 2025-06). Uses cursor-based pagination via
   * `nextPageToken` rather than the old startAt offset.
   */
  async searchIssues(opts: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    nextPageToken?: string;
  }): Promise<JiraSearchResult> {
    const url = `${this.baseUrl()}/search/jql`;
    const body: Record<string, unknown> = {
      jql: opts.jql,
      fields: opts.fields ?? [
        "summary",
        "status",
        "issuetype",
        "priority",
        "assignee",
        "reporter",
        "project",
        "created",
        "updated",
        "duedate",
        "labels",
      ],
      maxResults: opts.maxResults ?? 25,
    };
    if (opts.nextPageToken) body.nextPageToken = opts.nextPageToken;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Jira ${res.status} ${res.statusText} for /search/jql: ${text.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      issues?: JiraIssue[];
      total?: number;
      nextPageToken?: string;
      isLast?: boolean;
    };
    return {
      issues: data.issues ?? [],
      // The new endpoint doesn't always return `total` — fall back to issue count.
      total: data.total ?? data.issues?.length ?? 0,
      startAt: 0,
      maxResults: opts.maxResults ?? 25,
    };
  }

  async getIssue(idOrKey: string): Promise<JiraIssue> {
    return this.request(`/issue/${encodeURIComponent(idOrKey)}`);
  }

  /**
   * Create a new issue. Returns the created issue's key (e.g. "ENG-42").
   *
   * The Jira v3 API expects `description` in ADF (Atlassian Document Format)
   * — a JSON structure, not a string. To keep MCP tool ergonomics simple we
   * accept a plain string and wrap it in a minimal ADF document here. If the
   * caller already passes ADF (an object with type=doc) we pass it through.
   */
  async createIssue(opts: {
    projectKey: string;
    summary: string;
    issueType?: string;
    description?: string | Record<string, unknown>;
    assigneeAccountId?: string;
    priority?: string;
    labels?: string[];
    duedate?: string;
  }): Promise<{ id: string; key: string; self: string }> {
    const fields: Record<string, unknown> = {
      project: { key: opts.projectKey },
      summary: opts.summary,
      issuetype: { name: opts.issueType ?? "Task" },
    };

    if (opts.description !== undefined) {
      if (typeof opts.description === "string") {
        fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: opts.description }],
            },
          ],
        };
      } else {
        // Caller passed a pre-built ADF document.
        fields.description = opts.description;
      }
    }
    if (opts.assigneeAccountId) {
      fields.assignee = { accountId: opts.assigneeAccountId };
    }
    if (opts.priority) {
      fields.priority = { name: opts.priority };
    }
    if (opts.labels && opts.labels.length > 0) {
      fields.labels = opts.labels;
    }
    if (opts.duedate) {
      fields.duedate = opts.duedate;
    }

    const res = await fetch(`${this.baseUrl()}/issue`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Jira ${res.status} ${res.statusText} for /issue (create): ${text.slice(0, 400)}`,
      );
    }
    return (await res.json()) as { id: string; key: string; self: string };
  }

  /** GET /myself — the authenticated principal. */
  async whoami(): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
    return this.request("/myself");
  }

  /**
   * Cheap auth-ping. Returns false on any auth-related failure.
   */
  async ping(): Promise<boolean> {
    try {
      await this.whoami();
      return true;
    } catch {
      return false;
    }
  }
}
