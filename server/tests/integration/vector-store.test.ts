import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { vectorStoreService } from "../../services/vector-store.service";
import type { VectorChunk } from "../../services/vector-store.service";
import { Organization } from "../../entities/organization.entity";
import { Document, DocumentationType } from "../../entities/document.entity";

describe("VectorStore Integration Tests", () => {
  const testorganizationId = "123e4567-e89b-12d3-a456-426614174000";
  const testDocId = "456e7890-e89b-12d3-a456-426614174000";
  const deleteDocId = "789e0123-e89b-12d3-a456-426614174000";

  beforeAll(async () => {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Run migrations
    await AppDataSource.runMigrations();

    // Initialize vector store
    await vectorStoreService.initialize();

    // Create test organization
    const orgRepo = AppDataSource.getRepository(Organization);
    const existingOrg = await orgRepo.findOne({ where: { id: testorganizationId } });
    if (!existingOrg) {
      const testOrg = orgRepo.create({
        id: testorganizationId,
        name: "Test Organization",
        slug: "test-org",
      });
      await orgRepo.save(testOrg);
    }

    // Create test documents
    const docRepo = AppDataSource.getRepository(Document);
    const existingDoc = await docRepo.findOne({ where: { id: testDocId } });
    if (!existingDoc) {
      const testDoc = docRepo.create({
        id: testDocId,
        organizationId: testorganizationId,
        title: "Test Document",
        type: DocumentationType.ARTICLE,
      });
      await docRepo.save(testDoc);
    }

    // Create second test document for deletion tests
    const existingDeleteDoc = await docRepo.findOne({ where: { id: deleteDocId } });
    if (!existingDeleteDoc) {
      const deleteDoc = docRepo.create({
        id: deleteDocId,
        organizationId: testorganizationId,
        title: "Document for Deletion Tests",
        type: DocumentationType.ARTICLE,
      });
      await docRepo.save(deleteDoc);
    }
  });

  afterAll(async () => {
    // Clean up test data
    await vectorStoreService.deleteByOrganizationId(testorganizationId);

    // Clean up test documents
    const docRepo = AppDataSource.getRepository(Document);
    await docRepo.delete({ id: testDocId });
    await docRepo.delete({ id: deleteDocId });

    // Clean up test organization
    const orgRepo = AppDataSource.getRepository(Organization);
    await orgRepo.delete({ id: testorganizationId });

    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("addChunks", () => {
    it("should add text chunks with metadata", async () => {
      const chunks: VectorChunk[] = [
        {
          content: "This is the first test chunk",
          metadata: { index: 0, type: "test" },
        },
        {
          content: "This is the second test chunk",
          metadata: { index: 1, type: "test" },
        },
      ];

      const ids = await vectorStoreService.addChunks(testorganizationId, testDocId, chunks);

      expect(ids).toHaveLength(2);
      expect(ids[0]).toBeDefined();
      expect(ids[1]).toBeDefined();
    });

    it("should handle chunks without document ID", async () => {
      const chunks: VectorChunk[] = [
        {
          content: "Chunk without document association",
          metadata: { standalone: true },
        },
      ];

      const ids = await vectorStoreService.addChunks(testorganizationId, null, chunks);

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBeDefined();
    });
  });

  describe("search", () => {
    beforeAll(async () => {
      // Add test data for search
      const chunks: VectorChunk[] = [
        {
          content: "PostgreSQL is a powerful database system",
          metadata: { topic: "database" },
        },
        {
          content: "TypeORM is an ORM for TypeScript and JavaScript",
          metadata: { topic: "orm" },
        },
        {
          content: "Vector databases enable similarity search",
          metadata: { topic: "vectors" },
        },
      ];

      await vectorStoreService.addChunks(testorganizationId, testDocId, chunks);
    });

    it("should find similar content within organization", async () => {
      const results = await vectorStoreService.search(
        testorganizationId,
        "Tell me about databases",
        2,
      );

      expect(results.length).toBeLessThanOrEqual(2);
      expect(results[0].content).toBeDefined();
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });

    it("should not return results from other organizations", async () => {
      const otherorganizationId = "999e9999-e89b-12d3-a456-426614174000";

      const results = await vectorStoreService.search(otherorganizationId, "database", 10);

      expect(results).toHaveLength(0);
    });

    it("should respect the k parameter", async () => {
      const results = await vectorStoreService.search(testorganizationId, "database", 1);

      expect(results).toHaveLength(1);
    });
  });

  describe("deleteByDocumentId", () => {
    it("should delete embeddings for a specific document", async () => {
      // Add test embeddings
      const chunks: VectorChunk[] = [{ content: "Test chunk for deletion", metadata: {} }];
      await vectorStoreService.addChunks(testorganizationId, deleteDocId, chunks);

      // Delete embeddings
      const deletedCount = await vectorStoreService.deleteByDocumentId(
        testorganizationId,
        deleteDocId,
      );

      expect(deletedCount).toBeGreaterThan(0);

      // Verify deletion
      const results = await AppDataSource.query(
        `SELECT COUNT(*) as count FROM embeddings
         WHERE "organization_id" = $1 AND "document_id" = $2`,
        [testorganizationId, deleteDocId],
      );

      expect(results[0].count).toBe("0");
    });
  });

  describe("getStatistics", () => {
    it("should return correct statistics for organization", async () => {
      const stats = await vectorStoreService.getStatistics(testorganizationId);

      expect(stats).toHaveProperty("totalEmbeddings");
      expect(stats).toHaveProperty("totalDocuments");
      expect(stats).toHaveProperty("avgEmbeddingsPerDocument");
      expect(stats.totalEmbeddings).toBeGreaterThan(0);
    });
  });
});
