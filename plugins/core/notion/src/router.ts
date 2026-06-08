/**
 * Notion plugin tRPC router.
 *
 * Implements the DocumentImporterContract defined in
 * `server/types/plugin-sdk.types.ts`. The server's
 * `document-source-sync.service` resolves this router via
 * `pluginRouterRegistry` and invokes the procedures through
 * `router.createCaller(ctx)`, bypassing the HTTP layer. Because of that,
 * this router MUST be built with the same `t` instance as the rest of the
 * server (we import `publicProcedure` / `router` from `@server/trpc`).
 *
 * Procedure ↔ contract mapping:
 *   - listRoots   → the workspace ("all shared pages") plus one root per shared database
 *   - discover    → list pages in a root (workspace search OR database query), paginated
 *   - fetchPage   → fetch a page's block tree and convert it to Markdown
 *   - listChanges → list pages modified since `since` (sorted descending, truncates by date)
 *
 * Root id encoding:
 *   - "workspace"   → every page the integration can see (search, object=page)
 *   - "db:<id>"     → the rows of a single database
 *
 * Deletions are NOT detected incrementally (the Notion search/query endpoints
 * omit trashed pages); the sync engine's full-sweep reconcile pass tombstones
 * anything that disappears.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "@server/trpc";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { decryptConfig } from "@server/lib/auth/utils/encryption";
import type {
  DocumentImporterExternalPage,
  DocumentImporterFetchedPage,
  DocumentImporterPageChange,
  DocumentImporterRoot,
} from "@server/types/plugin-sdk.types";

import {
  NotionClient,
  pageTitle,
  richTextToPlain,
  type NotionDatabase,
  type NotionPage,
} from "./notion-client";
import { notionBlocksToMarkdown } from "./notion-to-markdown";

const NOTION_PLUGIN_ID = "notion";
const WORKSPACE_ROOT_ID = "workspace";
const DB_ROOT_PREFIX = "db:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a Notion client error to an appropriate tRPC error. */
function toTrpcError(err: unknown): TRPCError {
  const message = err instanceof Error ? err.message : String(err);
  if (/Notion 401\b/.test(message) || /Notion 403\b/.test(message)) {
    return new TRPCError({ code: "UNAUTHORIZED", message, cause: err });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message, cause: err });
}

/**
 * Resolve a Notion client from a plugin instance row. The integration token is
 * an encrypted config field; we decrypt it here (config is encrypted at rest by
 * `encryptConfig` on write).
 */
function clientFromInstance(instance: { config?: Record<string, unknown> | null }): NotionClient {
  const rawConfig = (instance.config ?? {}) as Record<string, unknown>;
  const config = decryptConfig(rawConfig);

  const apiToken = (config.apiToken as string | undefined) ?? "";
  const notionVersion = config.notionVersion as string | undefined;

  if (!apiToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "Notion is not configured — an internal integration token is required. " +
        "Add one in the Notion plugin settings.",
    });
  }

  return new NotionClient(apiToken, notionVersion);
}

/** Load the Notion plugin instance for an org and build a client. */
async function loadClient(instanceId: string): Promise<NotionClient> {
  const instance = await pluginInstanceRepository.findById(instanceId);
  if (!instance) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Notion plugin instance not found: ${instanceId}`,
    });
  }
  try {
    return clientFromInstance(instance);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw toTrpcError(err);
  }
}

function pageUpdatedAt(page: NotionPage): string {
  return page.last_edited_time ?? page.created_time ?? new Date(0).toISOString();
}

function toExternalPage(page: NotionPage): DocumentImporterExternalPage {
  return {
    externalId: page.id,
    title: pageTitle(page),
    externalUpdatedAt: pageUpdatedAt(page),
    externalUrl: page.url,
    metadata: { parent: page.parent?.type },
  };
}

/** Fetch one page of results for a root (workspace search or database query). */
async function fetchRootPage(
  client: NotionClient,
  rootId: string,
  opts: { cursor?: string; sortDescending?: boolean },
): Promise<{ results: NotionPage[]; nextCursor?: string }> {
  if (rootId.startsWith(DB_ROOT_PREFIX)) {
    const databaseId = rootId.slice(DB_ROOT_PREFIX.length);
    return client.queryDatabase({
      databaseId,
      cursor: opts.cursor,
      sortDescending: opts.sortDescending,
    });
  }

  // Workspace root: search restricted to pages.
  const { results, nextCursor } = await client.search({
    object: "page",
    cursor: opts.cursor,
    sortDescending: opts.sortDescending,
  });
  // search() returns pages and databases; with object=page it's pages only,
  // but narrow defensively.
  const pages = results.filter((r): r is NotionPage => r.object === "page");
  return { results: pages, nextCursor };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const notionRouter = router({
  /**
   * List importable roots: the whole workspace ("all shared pages") plus one
   * root per database the integration can access. A workspace member controls
   * scope by choosing which pages/databases to share with the integration.
   */
  listRoots: publicProcedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .query(async ({ input }): Promise<DocumentImporterRoot[]> => {
      const client = await loadClient(input.instanceId);

      const roots: DocumentImporterRoot[] = [
        {
          id: WORKSPACE_ROOT_ID,
          label: "All shared pages",
          metadata: { kind: "workspace" },
        },
      ];

      try {
        let cursor: string | undefined = undefined;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { results, nextCursor } = await client.search({
            object: "database",
            cursor,
          });
          for (const result of results) {
            if (result.object !== "database") continue;
            const db = result as NotionDatabase;
            const title = richTextToPlain(db.title) || "Untitled database";
            roots.push({
              id: `${DB_ROOT_PREFIX}${db.id}`,
              label: `${title} (database)`,
              metadata: { kind: "database", databaseId: db.id },
            });
          }
          if (!nextCursor) break;
          cursor = nextCursor;
        }
      } catch (err) {
        throw toTrpcError(err);
      }

      return roots;
    }),

  /**
   * Discover pages within a root — one page of results at a time, returning a
   * cursor the sync engine can pass back to continue.
   */
  discover: publicProcedure
    .input(
      z.object({
        instanceId: z.string().min(1),
        rootId: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .query(
      async ({
        input,
      }): Promise<{ pages: DocumentImporterExternalPage[]; nextCursor?: string }> => {
        const client = await loadClient(input.instanceId);
        try {
          const { results, nextCursor } = await fetchRootPage(client, input.rootId, {
            cursor: input.cursor,
          });
          return { pages: results.map(toExternalPage), nextCursor };
        } catch (err) {
          throw toTrpcError(err);
        }
      },
    ),

  /**
   * Fetch a page's full block tree and convert it to Markdown. An empty page
   * yields an empty body; the sync engine handles that (no chunks to embed).
   */
  fetchPage: publicProcedure
    .input(z.object({ instanceId: z.string().min(1), externalId: z.string().min(1) }))
    .query(async ({ input }): Promise<DocumentImporterFetchedPage> => {
      const client = await loadClient(input.instanceId);

      try {
        const page = await client.getPage(input.externalId);
        const blocks = await client.getBlockTree(input.externalId);
        const markdown = notionBlocksToMarkdown(blocks);

        return {
          externalId: page.id,
          title: pageTitle(page),
          markdown,
          externalUpdatedAt: pageUpdatedAt(page),
          externalUrl: page.url,
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * Incremental delta — pages in a root whose last_edited_time >= `since`.
   * Results come back sorted newest-first, so we stop walking (and drop the
   * cursor) once we see a page older than `since`.
   */
  listChanges: publicProcedure
    .input(
      z.object({
        instanceId: z.string().min(1),
        rootId: z.string().min(1),
        since: z.string().min(1),
        cursor: z.string().optional(),
      }),
    )
    .query(
      async ({
        input,
      }): Promise<{ changes: DocumentImporterPageChange[]; nextCursor?: string }> => {
        const client = await loadClient(input.instanceId);

        const sinceMs = Date.parse(input.since);
        if (isNaN(sinceMs)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `listChanges: invalid 'since' timestamp "${input.since}"`,
          });
        }

        try {
          const { results, nextCursor } = await fetchRootPage(client, input.rootId, {
            cursor: input.cursor,
            sortDescending: true,
          });

          const changes: DocumentImporterPageChange[] = [];
          let truncatedByDate = false;
          for (const page of results) {
            const updatedAt = pageUpdatedAt(page);
            const pageMs = Date.parse(updatedAt);
            if (!isNaN(pageMs) && pageMs < sinceMs) {
              // Sorted descending — the first older page means the rest are too.
              truncatedByDate = true;
              break;
            }
            changes.push({ externalId: page.id, op: "upsert", externalUpdatedAt: updatedAt });
          }

          return { changes, nextCursor: truncatedByDate ? undefined : nextCursor };
        } catch (err) {
          throw toTrpcError(err);
        }
      },
    ),
});

export type NotionRouter = typeof notionRouter;

// The plugin-manager loader looks for `default` first, then `router`.
export { notionRouter as router };
// eslint-disable-next-line import/no-default-export
export default notionRouter;

export const PLUGIN_ID = NOTION_PLUGIN_ID;
