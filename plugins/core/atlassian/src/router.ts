/**
 * Confluence plugin tRPC router.
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
 *   - listRoots   → list Confluence spaces
 *   - discover    → list pages in a space (paginated)
 *   - fetchPage   → fetch full page content + ADF→Markdown convert
 *   - listChanges → list pages modified since `since` (paginated, descending)
 *
 * Error handling:
 *   - Confluence 401/403 → tRPC UNAUTHORIZED
 *   - Anything else      → tRPC INTERNAL_SERVER_ERROR with the underlying message
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

import { ConfluenceClient, type AuthConfig, type ConfluencePage } from "./confluence-client";
import { adfToMarkdown, type AdfDocument } from "./adf-to-markdown";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFLUENCE_PLUGIN_ID = "confluence";

/** Map a Confluence client error to an appropriate tRPC error. */
function toTrpcError(err: unknown): TRPCError {
  const message = err instanceof Error ? err.message : String(err);

  // ConfluenceClient throws Error with a "Confluence <status> ..." message for HTTP failures.
  // Detect 401/403 so we can surface UNAUTHORIZED to the sync engine.
  if (/Confluence 401\b/.test(message) || /Confluence 403\b/.test(message)) {
    return new TRPCError({ code: "UNAUTHORIZED", message, cause: err });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message, cause: err });
}

/**
 * Resolve a Confluence AuthConfig from a plugin instance row.
 *
 * - config is encrypted at rest (`encryptConfig` is applied on write); we
 *   decrypt the `apiToken` field here.
 * - authState is auto-decrypted by the TypeORM transformer on the entity.
 */
function getAuthConfigFromInstance(instance: {
  config?: Record<string, unknown> | null;
  authState?: { methodId: string; credentials: Record<string, unknown> } | null;
}): AuthConfig {
  const rawConfig = (instance.config ?? {}) as Record<string, unknown>;
  const config = decryptConfig(rawConfig);

  const authMode = (config.authMode as string | undefined) ?? "basic";
  const siteUrl = (config.siteUrl as string | undefined) ?? "";

  if (authMode === "oauth") {
    const credentials = instance.authState?.credentials ?? {};
    const accessToken = credentials.accessToken as string | undefined;
    const cloudId =
      (credentials.cloudId as string | undefined) ?? (config.cloudId as string | undefined);

    if (!accessToken || !cloudId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Confluence OAuth is not fully configured — missing accessToken or cloudId. " +
          "Complete the OAuth flow for this plugin instance.",
      });
    }

    return { mode: "oauth", accessToken, cloudId };
  }

  // basic auth
  const email = (config.email as string | undefined) ?? "";
  const apiToken = (config.apiToken as string | undefined) ?? "";

  if (!email || !apiToken || !siteUrl) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "Confluence basic auth is not fully configured — siteUrl, email, and apiToken are required.",
    });
  }

  return { mode: "basic", email, apiToken, siteUrl };
}

/**
 * Load the Confluence plugin instance for an org and build a client.
 *
 * The instance is looked up by `instanceId` only (it's an opaque UUID owned
 * by the org that called us; `document-source-sync` always passes the
 * matching org's instance id). We do not cross-check organizationId here —
 * the caller context (createCaller) and the row's own organizationId would
 * always agree, so adding a redundant check would only complicate signatures.
 */
async function loadClient(instanceId: string): Promise<ConfluenceClient> {
  const instance = await pluginInstanceRepository.findById(instanceId);
  if (!instance) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Confluence plugin instance not found: ${instanceId}`,
    });
  }

  let auth: AuthConfig;
  try {
    auth = getAuthConfigFromInstance(instance);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw toTrpcError(err);
  }

  try {
    return new ConfluenceClient(auth);
  } catch (err) {
    throw toTrpcError(err);
  }
}

/** Build a fully-qualified webui URL from the configured site (basic auth only). */
function buildExternalUrl(
  siteUrl: string | undefined,
  webui: string | undefined,
): string | undefined {
  if (!webui) return undefined;
  if (/^https?:\/\//i.test(webui)) return webui;
  if (!siteUrl) return undefined;
  const site = siteUrl.replace(/\/+$/, "");
  const path = webui.startsWith("/") ? webui : `/${webui}`;
  return `${site}/wiki${path}`;
}

/** Read siteUrl from instance config (decrypted) — used only to construct externalUrl. */
async function getSiteUrl(instanceId: string): Promise<string | undefined> {
  const instance = await pluginInstanceRepository.findById(instanceId);
  if (!instance?.config) return undefined;
  const config = decryptConfig(instance.config);
  const siteUrl = config.siteUrl as string | undefined;
  return siteUrl && siteUrl.length > 0 ? siteUrl : undefined;
}

function pageUpdatedAt(page: ConfluencePage): string {
  return page.version?.modifiedAt ?? page.version?.createdAt ?? new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const confluenceRouter = router({
  /**
   * List Confluence spaces accessible with the configured auth.
   * Paginates through all pages of /spaces (limit=250 each).
   */
  listRoots: publicProcedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .query(async ({ input }): Promise<DocumentImporterRoot[]> => {
      const client = await loadClient(input.instanceId);

      const spaces: Array<{ id: string; key: string; name: string; type?: string }> = [];
      let cursor: string | undefined = undefined;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { results, nextCursor } = await client.listSpaces({ limit: 250, cursor });
          for (const space of results) {
            spaces.push({ id: space.id, key: space.key, name: space.name, type: space.type });
          }
          if (!nextCursor) break;
          cursor = nextCursor;
        }
      } catch (err) {
        throw toTrpcError(err);
      }

      // Fetch page counts in parallel via the v1 search API. countPagesInSpace
      // returns null on failure, so a single broken space doesn't poison the
      // whole picker — the UI just renders that row without a count.
      const counts = await Promise.all(spaces.map((s) => client.countPagesInSpace(s.key)));

      return spaces.map((space, i) => ({
        id: space.id,
        label: `${space.name} (${space.key})`,
        metadata: {
          key: space.key,
          type: space.type,
          pageCount: counts[i] ?? null,
        },
      }));
    }),

  /**
   * Discover pages within a space — one page of results at a time.
   * Returns a cursor that the sync engine can pass back to continue.
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
        const siteUrl = await getSiteUrl(input.instanceId);

        try {
          const { results, nextCursor } = await client.listPagesInSpace({
            spaceId: input.rootId,
            limit: 100,
            cursor: input.cursor,
          });

          const pages: DocumentImporterExternalPage[] = results.map((page) => ({
            externalId: page.id,
            title: page.title,
            externalUpdatedAt: pageUpdatedAt(page),
            externalUrl: buildExternalUrl(siteUrl, page._links?.webui),
            metadata: {
              spaceId: page.spaceId,
              version: page.version?.number,
            },
          }));

          return { pages, nextCursor };
        } catch (err) {
          throw toTrpcError(err);
        }
      },
    ),

  /**
   * Fetch a page's full body and convert ADF JSON → Markdown.
   * If the body is missing or malformed we still return a placeholder
   * document so the sync engine can record metadata + a visible gap marker.
   */
  fetchPage: publicProcedure
    .input(z.object({ instanceId: z.string().min(1), externalId: z.string().min(1) }))
    .query(async ({ input }): Promise<DocumentImporterFetchedPage> => {
      const client = await loadClient(input.instanceId);
      const siteUrl = await getSiteUrl(input.instanceId);

      let page: ConfluencePage & { body: { atlas_doc_format?: { value: string } } };
      try {
        page = await client.getPage({ pageId: input.externalId });
      } catch (err) {
        throw toTrpcError(err);
      }

      let markdown = "> [Confluence page body unavailable]";
      const adfRaw = page.body?.atlas_doc_format?.value;
      if (adfRaw && adfRaw.length > 0) {
        try {
          const adfJson = JSON.parse(adfRaw) as AdfDocument;
          markdown = adfToMarkdown(adfJson);
        } catch {
          // Leave the placeholder in place. We could log here, but the plugin
          // process is a child worker; the sync engine already logs failures.
          markdown = "> [Confluence page body unavailable: malformed ADF JSON]";
        }
      }

      return {
        externalId: page.id,
        title: page.title,
        markdown,
        externalUpdatedAt: pageUpdatedAt(page),
        externalUrl: buildExternalUrl(siteUrl, page._links?.webui),
      };
    }),

  /**
   * Incremental delta — list pages in a space whose modifiedAt >= `since`.
   * The client paginates from newest-first and stops walking once it sees
   * a page older than `since`, so this naturally truncates without
   * over-fetching.
   *
   * Deletions are NOT detected here; the sync engine's reconcile pass
   * handles tombstoning by diffing against a full sweep.
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

        try {
          const { results, nextCursor } = await client.listPagesModifiedSince({
            spaceId: input.rootId,
            sinceISO: input.since,
            limit: 100,
            cursor: input.cursor,
          });

          const changes: DocumentImporterPageChange[] = results.map((page) => ({
            externalId: page.id,
            op: "upsert",
            externalUpdatedAt: pageUpdatedAt(page),
          }));

          return { changes, nextCursor };
        } catch (err) {
          throw toTrpcError(err);
        }
      },
    ),
});

export type ConfluenceRouter = typeof confluenceRouter;

// The plugin-manager loader looks for `default` first, then `router`.
// We expose `confluenceRouter` (named), `router` (alias for the loader), and
// `default` so any consumer convention works.
export { confluenceRouter as router };
// eslint-disable-next-line import/no-default-export
export default confluenceRouter;

// Mark the plugin id this router belongs to — useful for tests/debugging.
export const PLUGIN_ID = CONFLUENCE_PLUGIN_ID;
