import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import { documentRepository } from "@server/repositories/document.repository";
import { documentSourceSyncService } from "@server/services/document-source-sync.service";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginRouterRegistry } from "@server/services/plugin-router-registry.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { vectorStoreService } from "@server/services/vector-store.service";
import {
  WEBSITE_PLUGIN_ID,
  WEBSITE_SOURCE_TYPE,
} from "@server/services/importers/website-importer";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import { AppDataSource } from "@server/database/data-source";
import { Job } from "@server/entities/job.entity";
import { DocumentSource } from "@server/entities/document-source.entity";
import { createLogger } from "@server/lib/logger";

/** Default re-sync cadence for website sources: incremental delta once a day. */
const WEBSITE_DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

const logger = createLogger("document-sources");

/**
 * Serialize a DocumentSource for API consumers. Keeps shape stable across
 * procedures so the dashboard can rely on a single TypeScript inference.
 */
function serialize(source: DocumentSource) {
  return {
    id: source.id,
    pluginId: source.pluginId,
    pluginInstanceId: source.pluginInstanceId ?? null,
    sourceType: source.sourceType,
    displayName: source.displayName,
    externalRootId: source.externalRootId ?? null,
    externalRootLabel: source.externalRootLabel ?? null,
    config: source.config ?? {},
    syncIntervalMs: source.syncIntervalMs ?? null,
    enabled: source.enabled,
    lastSyncedAt: source.lastSyncedAt ?? null,
    lastSyncStatus: source.lastSyncStatus,
    lastSyncError: source.lastSyncError ?? null,
    lastSyncStats: source.lastSyncStats ?? null,
    lastSyncCursor: source.lastSyncCursor ?? null,
    lastFullSweepAt: source.lastFullSweepAt ?? null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export const documentSourcesRouter = t.router({
  /**
   * List every document source for the current organization.
   * Includes lastSyncStats so the dashboard can render per-source health.
   */
  list: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ).query(async ({ ctx }) => {
    const sources = await documentSourceRepository.findByOrganization(ctx.organizationId!);
    return sources.map(serialize);
  }),

  /**
   * Fetch a single document source by id, scoped to the caller's org.
   */
  get: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const source = await documentSourceRepository.findById(input.id, ctx.organizationId!);
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document source not found" });
      }
      const documentsCount = await documentRepository.countByDocumentSourceId(input.id);
      return { ...serialize(source), documentsCount };
    }),

  /**
   * Proxy to a document_importer plugin's listRoots procedure. Used by the
   * dashboard's import wizard to let the user pick a root (Confluence space,
   * GitHub repo, etc.) before creating a DocumentSource. Resolves the plugin's
   * tRPC sub-router via the registry and invokes its createCaller, the same
   * mechanism the sync service uses.
   */
  listRoots: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        pluginId: z.string().min(1),
        instanceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const plugin = pluginManagerService.getPlugin(input.pluginId);
      if (!plugin) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Plugin not found: ${input.pluginId}`,
        });
      }

      // Make sure the instance belongs to the caller's org. Without this we'd
      // happily list roots for someone else's account.
      const instance = await pluginInstanceRepository.findByOrgAndPlugin(
        ctx.organizationId!,
        input.pluginId,
      );
      if (!instance || instance.id !== input.instanceId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Plugin instance not found for this organization",
        });
      }

      // Self-heal: a plugin built/installed/enabled after server boot may not
      // have had its router registered yet (registration was boot-only). Load
      // it on demand so the import wizard works without a server restart.
      await pluginManagerService.ensurePluginRouterRegistered(input.pluginId);

      const pluginRouter = pluginRouterRegistry.getRouter(input.pluginId);
      if (!pluginRouter || typeof pluginRouter.createCaller !== "function") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plugin '${input.pluginId}' does not expose a router with listRoots`,
        });
      }

      const callerCtx = {
        user: null,
        organizationId: ctx.organizationId!,
        req: undefined as unknown as never,
        res: undefined as unknown as never,
      };

      try {
        const caller = pluginRouter.createCaller(callerCtx);
        if (typeof caller.listRoots !== "function") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Plugin '${input.pluginId}' does not implement listRoots`,
          });
        }
        const roots = await caller.listRoots({ instanceId: input.instanceId });
        return { roots };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, pluginId: input.pluginId }, "listRoots passthrough failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "listRoots failed",
        });
      }
    }),

  /**
   * Create a new document source. Validates that the referenced plugin is
   * registered and advertises the document_importer capability — otherwise the
   * sync engine has no contract to call.
   */
  create: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.CREATE)
    .input(
      z.object({
        pluginId: z.string().min(1),
        pluginInstanceId: z.string().uuid().optional(),
        displayName: z.string().min(1).max(255),
        sourceType: z.string().min(1).max(50),
        externalRootId: z.string().max(255).optional(),
        externalRootLabel: z.string().max(255).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        syncIntervalMs: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plugin = pluginManagerService.getPlugin(input.pluginId);
      if (!plugin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plugin not found: ${input.pluginId}`,
        });
      }

      const manifest = plugin.manifest;
      const isDocumentImporter =
        Array.isArray(manifest.type) && manifest.type.includes("document_importer");
      const hasImporterCapability = Boolean(manifest.capabilities?.document_importer);

      if (!isDocumentImporter && !hasImporterCapability) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Plugin '${input.pluginId}' is not a document_importer`,
        });
      }

      const created = await documentSourceRepository.create({
        organizationId: ctx.organizationId!,
        pluginId: input.pluginId,
        pluginInstanceId: input.pluginInstanceId,
        displayName: input.displayName,
        sourceType: input.sourceType,
        externalRootId: input.externalRootId,
        externalRootLabel: input.externalRootLabel,
        config: input.config ?? {},
        syncIntervalMs: input.syncIntervalMs,
      });

      return serialize(created);
    }),

  /**
   * Connect a website as a document source. Unlike `create`, websites are not
   * backed by a plugin — they use the built-in WebsiteImporter (pluginId
   * `core:website`). We SSRF-validate the URL, persist the source, and kick off
   * an initial full sweep so pages start appearing immediately.
   */
  createWebsite: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.CREATE)
    .input(
      z.object({
        url: z.string().url(),
        displayName: z.string().min(1).max(255).optional(),
        syncIntervalMs: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Block SSRF (internal IPs, link-local, etc.) before we ever store or fetch.
      await validateUrlForSSRF(input.url);

      let normalizedUrl: string;
      let hostname: string;
      try {
        const parsed = new URL(input.url);
        // Normalize to origin so the same site isn't connected twice under
        // trivially different paths/queries. externalId per page keeps the
        // full URL.
        normalizedUrl = parsed.origin;
        hostname = parsed.hostname;
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid website URL" });
      }

      const created = await documentSourceRepository.create({
        organizationId: ctx.organizationId!,
        pluginId: WEBSITE_PLUGIN_ID,
        displayName: input.displayName?.trim() || hostname,
        sourceType: WEBSITE_SOURCE_TYPE,
        externalRootId: normalizedUrl,
        externalRootLabel: hostname,
        config: { url: normalizedUrl },
        syncIntervalMs:
          input.syncIntervalMs === undefined
            ? WEBSITE_DEFAULT_SYNC_INTERVAL_MS
            : (input.syncIntervalMs ?? undefined),
      });

      // Start an initial sweep right away so the source isn't empty while the
      // user waits for the scheduler.
      const { jobId } = await documentSourceSyncService.enqueueSync(created.id, {
        forceFullSweep: true,
      });

      return { ...serialize(created), jobId };
    }),

  /**
   * Patch a document source. sourceType and pluginId are immutable once set —
   * changing them would invalidate every existing externalId and break the
   * sync engine's idempotency.
   */
  update: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z
          .object({
            displayName: z.string().min(1).max(255).optional(),
            enabled: z.boolean().optional(),
            syncIntervalMs: z.number().int().positive().nullable().optional(),
            config: z.record(z.string(), z.unknown()).optional(),
          })
          .refine((p) => Object.keys(p).length > 0, {
            message: "patch must include at least one field",
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await documentSourceRepository.findById(input.id, ctx.organizationId!);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document source not found" });
      }

      const patch: Partial<DocumentSource> = {};
      if (input.patch.displayName !== undefined) patch.displayName = input.patch.displayName;
      if (input.patch.enabled !== undefined) patch.enabled = input.patch.enabled;
      if (input.patch.syncIntervalMs !== undefined) {
        // null clears the interval (manual-only sync); a number sets it.
        patch.syncIntervalMs = input.patch.syncIntervalMs ?? undefined;
      }
      if (input.patch.config !== undefined) patch.config = input.patch.config;

      const updated = await documentSourceRepository.update(
        existing.id,
        ctx.organizationId!,
        patch,
      );
      return serialize(updated);
    }),

  /**
   * Delete a document source. By default the FK on documents
   * (document_source_id) is ON DELETE SET NULL, so historical docs are
   * preserved but detach from the source. Passing deleteDocuments=true also
   * removes the docs and their embeddings — this is irreversible.
   */
  delete: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.DELETE)
    .input(
      z.object({
        id: z.string().uuid(),
        deleteDocuments: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await documentSourceRepository.findById(input.id, ctx.organizationId!);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document source not found" });
      }

      let deletedDocuments = 0;
      if (input.deleteDocuments) {
        if (!vectorStoreService.initialized) {
          await vectorStoreService.initialize();
        }
        // Hard-delete every doc tied to this source plus its embeddings.
        // Done before deleting the source row so ON DELETE SET NULL doesn't
        // strip the FK we're filtering on.
        const docs = await documentRepository.findByDocumentSourceId(existing.id);
        for (const doc of docs) {
          try {
            await vectorStoreService.deleteByDocumentId(ctx.organizationId!, doc.id);
            await documentRepository.delete(doc.id, ctx.organizationId!);
            deletedDocuments += 1;
          } catch (err) {
            logger.error(
              { err, documentId: doc.id, documentSourceId: existing.id },
              "Failed to delete document during source deletion",
            );
          }
        }
      }

      const deleted = await documentSourceRepository.delete(existing.id, ctx.organizationId!);
      if (!deleted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete document source",
        });
      }

      return {
        success: true,
        deletedDocuments,
      };
    }),

  /**
   * Enqueue a sync run for this source. Returns the queued job id so the
   * caller can poll getSyncHistory or the generic job endpoints.
   */
  syncNow: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        forceFullSweep: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await documentSourceRepository.findById(input.id, ctx.organizationId!);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document source not found" });
      }

      const { jobId } = await documentSourceSyncService.enqueueSync(existing.id, {
        forceFullSweep: input.forceFullSweep,
      });

      return { jobId };
    }),

  /**
   * Recent sync jobs for a source. Pulled from the generic jobs table by
   * filtering data.type='document_source_sync' AND data.documentSourceId=:id.
   * Bounded by `limit` and scoped to the caller's organization.
   */
  getSyncHistory: scopedProcedure(RESOURCES.DOCUMENTS, ACTIONS.READ)
    .input(
      z.object({
        id: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional().default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const existing = await documentSourceRepository.findById(input.id, ctx.organizationId!);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document source not found" });
      }

      const jobs: Job[] = await AppDataSource.getRepository(Job)
        .createQueryBuilder("job")
        .where("job.organization_id = :organizationId", {
          organizationId: ctx.organizationId!,
        })
        .andWhere("job.data ->> 'type' = :type", { type: "document_source_sync" })
        .andWhere("job.data ->> 'documentSourceId' = :documentSourceId", {
          documentSourceId: existing.id,
        })
        .orderBy("job.created_at", "DESC")
        .limit(input.limit)
        .getMany();

      return jobs.map((job) => ({
        id: job.id,
        status: job.status,
        priority: job.priority,
        title: job.title,
        description: job.description,
        data: job.data ?? null,
        result: job.result ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }));
    }),
});
