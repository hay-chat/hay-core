import type { QueryDeepPartialEntity } from "typeorm";
import { BaseRepository } from "./base.repository";
import { DocumentSource, DocumentSourceSyncStatus } from "../entities/document-source.entity";

type RecordSyncResultInput = {
  status: "success" | "error" | "partial" | "idle";
  error?: string | null;
  cursor?: string | null;
  stats?: Record<string, unknown> | null;
  isFullSweep?: boolean;
};

/**
 * Matches a source no live worker is syncing. One invocation runs for under a
 * minute, so a claim this old was left by a server that stopped mid-run.
 */
const NOT_ACTIVELY_RUNNING_SQL = `last_sync_status IS NULL
           OR last_sync_status != 'running'
           OR COALESCE(last_sync_started_at, 'epoch') < now() - interval '15 minutes'`;

export class DocumentSourceRepository extends BaseRepository<DocumentSource> {
  constructor() {
    super(DocumentSource);
  }

  /**
   * Create a new document source scoped to an organization.
   */
  override async create(
    input: Partial<DocumentSource> & { organizationId: string },
  ): Promise<DocumentSource> {
    const entity = this.getRepository().create(input);
    return this.getRepository().save(entity);
  }

  /**
   * Find a document source by id, scoped to an organization (tenant safe).
   */
  override async findById(id: string, organizationId?: string): Promise<DocumentSource | null> {
    if (!organizationId) {
      // Maintain BaseRepository signature compatibility but discourage usage.
      // Prefer findByIdInternal for sync-engine paths without org context.
      return this.getRepository().findOne({ where: { id } });
    }
    return this.getRepository().findOne({ where: { id, organizationId } });
  }

  /**
   * Find a document source by id without organization scoping.
   * For use by the sync engine, which operates without an organization context.
   */
  async findByIdInternal(id: string): Promise<DocumentSource | null> {
    return this.getRepository().findOne({ where: { id } });
  }

  /**
   * Find all document sources for an organization.
   */
  override async findByOrganization(organizationId: string): Promise<DocumentSource[]> {
    return this.getRepository().find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Find all document sources tied to a plugin instance.
   */
  async findByPluginInstance(pluginInstanceId: string): Promise<DocumentSource[]> {
    return this.getRepository().find({
      where: { pluginInstanceId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Update a document source, scoped to an organization.
   */
  override async update(
    id: string,
    organizationId: string,
    patch: Partial<DocumentSource>,
  ): Promise<DocumentSource> {
    await this.getRepository().update(
      { id, organizationId },
      patch as QueryDeepPartialEntity<DocumentSource>,
    );
    const updated = await this.findById(id, organizationId);
    if (!updated) {
      throw new Error(
        `DocumentSource ${id} not found for organization ${organizationId} after update`,
      );
    }
    return updated;
  }

  /**
   * Delete a document source, scoped to an organization.
   */
  override async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.getRepository().delete({ id, organizationId });
    return result.affected !== 0;
  }

  /**
   * Find sources that are due for a sync run.
   *
   * A source is due when:
   *   - enabled = true
   *   - it is not currently running (a run older than the stale limit belongs
   *     to a server that died, so it no longer counts)
   *   - it has never synced, OR its last run hit the time budget with work left
   *     (partial), OR (syncIntervalMs is configured and the interval has elapsed
   *     since lastSyncedAt)
   */
  async findDueForSync(): Promise<DocumentSource[]> {
    const rows = await this.getRepository().query(
      `SELECT * FROM document_sources
       WHERE enabled = true
         AND (${NOT_ACTIVELY_RUNNING_SQL})
         AND (
           last_synced_at IS NULL
           OR last_sync_status = 'partial'
           OR last_sync_status = 'running'
           OR (
             sync_interval_ms IS NOT NULL
             AND now() - last_synced_at > make_interval(secs => sync_interval_ms::float / 1000)
           )
         )`,
    );

    // Hydrate raw rows into entity instances so callers get proper typing.
    return this.getRepository().create(rows as DocumentSource[]);
  }

  /**
   * Atomically claim a source for syncing by transitioning it to 'running'.
   * Returns true if this caller successfully claimed the source, false if
   * another worker holds a live claim on it.
   */
  async markRunning(id: string): Promise<boolean> {
    // TypeORM's postgres driver returns [rows, affectedCount] for UPDATE ... RETURNING.
    const [rows]: [Array<{ id: string }>, number] = await this.getRepository().query(
      `UPDATE document_sources
       SET last_sync_status = 'running',
           last_sync_started_at = now(),
           updated_at = now()
       WHERE id = $1
         AND (${NOT_ACTIVELY_RUNNING_SQL})
       RETURNING id`,
      [id],
    );

    return rows.length > 0;
  }

  /**
   * Record the outcome of a sync attempt.
   * - lastSyncedAt is always set to now()
   * - lastSyncCursor is cleared on 'success', preserved on 'partial', overwritten when provided
   * - lastFullSweepAt is set to now() when isFullSweep is true
   */
  async recordSyncResult(id: string, result: RecordSyncResultInput): Promise<void> {
    const patch: Partial<DocumentSource> = {
      lastSyncStatus: result.status as DocumentSourceSyncStatus,
      lastSyncedAt: new Date(),
      lastSyncError: result.error ?? undefined,
      lastSyncStats: (result.stats ?? null) as DocumentSource["lastSyncStats"],
    };

    if (result.status === "success") {
      // Clear cursor on a clean full pass; an explicit cursor override still wins. It must be null:
      // TypeORM skips undefined, which would leave the next sync resuming from the old offset.
      patch.lastSyncCursor = result.cursor ?? null;
    } else if (result.cursor !== undefined) {
      patch.lastSyncCursor = result.cursor ?? undefined;
    }

    if (result.isFullSweep) {
      patch.lastFullSweepAt = new Date();
    }

    await this.getRepository().update({ id }, patch as QueryDeepPartialEntity<DocumentSource>);
  }
}

export const documentSourceRepository = new DocumentSourceRepository();
