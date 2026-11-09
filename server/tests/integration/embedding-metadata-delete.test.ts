import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { vectorStoreService } from "../../services/vector-store.service";

describe("deleting embeddings by metadata", () => {
  const orgId = randomUUID();

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'emb', $2)`, [
      orgId,
      `emb-${orgId}`,
    ]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("is not broken by a stored value that isn't a UUID, and removes only the target", async () => {
    const target = randomUUID();
    for (const conversationId of [target, "not-a-uuid"]) {
      await AppDataSource.query(
        `INSERT INTO embeddings (organization_id, page_content, metadata) VALUES ($1, 'x', $2::jsonb)`,
        [orgId, JSON.stringify({ conversationId })],
      );
    }

    await expect(vectorStoreService.deleteByConversationIds(orgId, [target])).resolves.toBe(1);

    const remaining = await AppDataSource.query(
      `SELECT metadata->>'conversationId' AS id FROM embeddings WHERE organization_id = $1`,
      [orgId],
    );
    expect(remaining).toEqual([{ id: "not-a-uuid" }]);
  });
});
