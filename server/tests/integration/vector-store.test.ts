import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { vectorStoreService } from "../../services/vector-store.service";
import type { VectorChunk } from "../../services/vector-store.service";
import { Organization } from "../../entities/organization.entity";
import { Document, DocumentationType } from "../../entities/document.entity";

describe("VectorStore Integration Tests", () => {
  const testOrgId = "123e4567-e89b-12d3-a456-426614174000";
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
    const existingOrg = await orgRepo.findOne({ where: { id: testOrgId } });
    if (!existingOrg) {
      const testOrg = orgRepo.create({
        id: testOrgId,
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
        organizationId: testOrgId,
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
        organizationId: testOrgId,
        title: "Document for Deletion Tests",
        type: DocumentationType.ARTICLE,
      });
      await docRepo.save(deleteDoc);
    }
  });

  afterAll(async () => {
    // Clean up test data
    await vectorStoreService.deleteByOrganizationId(testOrgId);

    // Clean up test documents
    const docRepo = AppDataSource.getRepository(Document);
    await docRepo.delete({ id: testDocId });
    await docRepo.delete({ id: deleteDocId });

    // Clean up test organization
    const orgRepo = AppDataSource.getRepository(Organization);
    await orgRepo.delete({ id: testOrgId });

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

      const ids = await vectorStoreService.addChunks(testOrgId, testDocId, chunks);

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

      const ids = await vectorStoreService.addChunks(testOrgId, null, chunks);

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

      await vectorStoreService.addChunks(testOrgId, testDocId, chunks);
    });

    it("should find similar content within organization", async () => {
      const results = await vectorStoreService.search(testOrgId, "Tell me about databases", 2);

      expect(results.length).toBeLessThanOrEqual(2);
      expect(results[0].content).toBeDefined();
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });

    it("should not return results from other organizations", async () => {
      const otherOrgId = "999e9999-e89b-12d3-a456-426614174000";

      const results = await vectorStoreService.search(otherOrgId, "database", 10);

      expect(results).toHaveLength(0);
    });

    it("should respect the k parameter", async () => {
      const results = await vectorStoreService.search(testOrgId, "database", 1);

      expect(results).toHaveLength(1);
    });
  });

  describe("deleteByDocumentId", () => {
    it("should delete embeddings for a specific document", async () => {
      // Add test embeddings
      const chunks: VectorChunk[] = [{ content: "Test chunk for deletion", metadata: {} }];
      await vectorStoreService.addChunks(testOrgId, deleteDocId, chunks);

      // Delete embeddings
      const deletedCount = await vectorStoreService.deleteByDocumentId(testOrgId, deleteDocId);

      expect(deletedCount).toBeGreaterThan(0);

      // Verify deletion
      const results = await AppDataSource.query(
        `SELECT COUNT(*) as count FROM embeddings
         WHERE "organization_id" = $1 AND "document_id" = $2`,
        [testOrgId, deleteDocId],
      );

      expect(results[0].count).toBe("0");
    });
  });

  describe("getStatistics", () => {
    it("should return correct statistics for organization", async () => {
      const stats = await vectorStoreService.getStatistics(testOrgId);

      expect(stats).toHaveProperty("totalEmbeddings");
      expect(stats).toHaveProperty("totalDocuments");
      expect(stats).toHaveProperty("avgEmbeddingsPerDocument");
      expect(stats.totalEmbeddings).toBeGreaterThan(0);
    });
  });

  /**
   * GDPR DSAR Embedding Tests
   * These tests verify that embeddings can be properly deleted for GDPR compliance
   * Ticket: DSAR Data Traversal and Erasure
   */
  describe("GDPR - deleteByConversationIds", () => {
    const testConversationId1 = "conv0001-e89b-12d3-a456-426614174000";
    const testConversationId2 = "conv0002-e89b-12d3-a456-426614174000";

    beforeAll(async () => {
      // Add test embeddings with conversation metadata
      const chunks: VectorChunk[] = [
        {
          content: "Customer message from conversation 1",
          metadata: { conversationId: testConversationId1, type: "customer_message" },
        },
        {
          content: "Another customer message from conversation 1",
          metadata: { conversationId: testConversationId1, type: "customer_message" },
        },
        {
          content: "Message from conversation 2",
          metadata: { conversationId: testConversationId2, type: "customer_message" },
        },
      ];

      await vectorStoreService.addChunks(testOrgId, null, chunks);
    });

    it("should delete embeddings by conversation ID", async () => {
      // Verify embeddings exist before deletion
      const beforeResults = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversationId1],
      );
      expect(beforeResults.length).toBeGreaterThan(0);

      // Delete embeddings for conversation 1
      const deletedCount = await vectorStoreService.deleteByConversationIds(
        testOrgId,
        [testConversationId1],
      );

      expect(deletedCount).toBeGreaterThan(0);

      // Verify embeddings are deleted (post-delete search returns 0)
      const afterResults = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversationId1],
      );
      expect(afterResults.length).toBe(0);
    });

    it("should not delete embeddings from other conversations", async () => {
      // Conversation 2 embeddings should still exist
      const results = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversationId2],
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it("should delete embeddings for multiple conversations at once", async () => {
      // Add more embeddings
      const chunks: VectorChunk[] = [
        {
          content: "Multi-delete test message 1",
          metadata: { conversationId: "multi0001-e89b-12d3-a456-426614174000", type: "test" },
        },
        {
          content: "Multi-delete test message 2",
          metadata: { conversationId: "multi0002-e89b-12d3-a456-426614174000", type: "test" },
        },
      ];
      await vectorStoreService.addChunks(testOrgId, null, chunks);

      // Delete multiple conversations
      const deletedCount = await vectorStoreService.deleteByConversationIds(testOrgId, [
        "multi0001-e89b-12d3-a456-426614174000",
        "multi0002-e89b-12d3-a456-426614174000",
      ]);

      expect(deletedCount).toBe(2);

      // Verify both are deleted
      const results = await vectorStoreService.findByConversationIds(testOrgId, [
        "multi0001-e89b-12d3-a456-426614174000",
        "multi0002-e89b-12d3-a456-426614174000",
      ]);
      expect(results.length).toBe(0);
    });

    it("should return 0 when no conversations match", async () => {
      const deletedCount = await vectorStoreService.deleteByConversationIds(testOrgId, [
        "nonexist-e89b-12d3-a456-426614174000",
      ]);
      expect(deletedCount).toBe(0);
    });

    it("should return 0 for empty conversation array", async () => {
      const deletedCount = await vectorStoreService.deleteByConversationIds(testOrgId, []);
      expect(deletedCount).toBe(0);
    });
  });

  describe("GDPR - deleteByMessageIds", () => {
    const testMessageId1 = "msg00001-e89b-12d3-a456-426614174000";
    const testMessageId2 = "msg00002-e89b-12d3-a456-426614174000";

    beforeAll(async () => {
      // Add test embeddings with message metadata
      const chunks: VectorChunk[] = [
        {
          content: "Embedding from message 1",
          metadata: { messageId: testMessageId1, type: "message_embedding" },
        },
        {
          content: "Embedding from message 2",
          metadata: { messageId: testMessageId2, type: "message_embedding" },
        },
      ];

      await vectorStoreService.addChunks(testOrgId, null, chunks);
    });

    it("should delete embeddings by message ID", async () => {
      // Verify embeddings exist
      const beforeResults = await vectorStoreService.findByMessageIds(
        testOrgId,
        [testMessageId1],
      );
      expect(beforeResults.length).toBeGreaterThan(0);

      // Delete
      const deletedCount = await vectorStoreService.deleteByMessageIds(
        testOrgId,
        [testMessageId1],
      );
      expect(deletedCount).toBeGreaterThan(0);

      // Verify deletion (post-delete search returns 0)
      const afterResults = await vectorStoreService.findByMessageIds(
        testOrgId,
        [testMessageId1],
      );
      expect(afterResults.length).toBe(0);
    });
  });

  describe("GDPR - findByConversationIds", () => {
    const findTestConvId = "findconv-e89b-12d3-a456-426614174000";

    beforeAll(async () => {
      // Add test embeddings
      const chunks: VectorChunk[] = [
        {
          content: "Find test embedding content",
          metadata: { conversationId: findTestConvId, extra: "data" },
        },
      ];
      await vectorStoreService.addChunks(testOrgId, null, chunks);
    });

    it("should find embeddings by conversation IDs for export", async () => {
      const results = await vectorStoreService.findByConversationIds(
        testOrgId,
        [findTestConvId],
      );

      expect(results.length).toBe(1);
      expect(results[0].pageContent).toBe("Find test embedding content");
      expect(results[0].metadata).toHaveProperty("conversationId", findTestConvId);
      expect(results[0].id).toBeDefined();
    });

    it("should return empty array for non-existent conversations", async () => {
      const results = await vectorStoreService.findByConversationIds(
        testOrgId,
        ["nonexist-e89b-12d3-a456-426614174000"],
      );
      expect(results.length).toBe(0);
    });

    it("should return empty array for empty input", async () => {
      const results = await vectorStoreService.findByConversationIds(testOrgId, []);
      expect(results.length).toBe(0);
    });

    // Cleanup
    afterAll(async () => {
      await vectorStoreService.deleteByConversationIds(testOrgId, [findTestConvId]);
    });
  });

  describe("GDPR - Complete Customer Erasure Flow", () => {
    /**
     * This test simulates a complete GDPR erasure request:
     * 1. Create embeddings for a customer's conversations
     * 2. Verify embeddings can be found via search
     * 3. Delete all embeddings for the customer
     * 4. Verify "post-delete search returns 0" (per ticket AC)
     */
    const customerConvId = "custdel-e89b-12d3-a456-426614174000";
    const customerMessageIds = [
      "custmsg1-e89b-12d3-a456-426614174000",
      "custmsg2-e89b-12d3-a456-426614174000",
    ];

    beforeAll(async () => {
      // Simulate customer data with embeddings
      const chunks: VectorChunk[] = [
        {
          content: "Hello, I need help with my order #12345",
          metadata: {
            conversationId: customerConvId,
            messageId: customerMessageIds[0],
            customerId: "customer-to-delete",
          },
        },
        {
          content: "My email is customer@example.com and phone is 555-1234",
          metadata: {
            conversationId: customerConvId,
            messageId: customerMessageIds[1],
            customerId: "customer-to-delete",
          },
        },
      ];

      await vectorStoreService.addChunks(testOrgId, null, chunks);
    });

    it("should find customer embeddings before deletion", async () => {
      const results = await vectorStoreService.findByConversationIds(
        testOrgId,
        [customerConvId],
      );
      expect(results.length).toBe(2);
    });

    it("should return search results for customer data before deletion", async () => {
      const results = await vectorStoreService.search(testOrgId, "order #12345", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should delete all customer embeddings", async () => {
      // Delete by conversation
      const deletedByConv = await vectorStoreService.deleteByConversationIds(
        testOrgId,
        [customerConvId],
      );
      expect(deletedByConv).toBe(2);
    });

    it("should return 0 results after deletion (GDPR compliance)", async () => {
      // This is the key acceptance criteria: "post-delete search returns 0"
      const conversationResults = await vectorStoreService.findByConversationIds(
        testOrgId,
        [customerConvId],
      );
      expect(conversationResults.length).toBe(0);

      const messageResults = await vectorStoreService.findByMessageIds(
        testOrgId,
        customerMessageIds,
      );
      expect(messageResults.length).toBe(0);
    });

    it("should not find deleted customer data via semantic search", async () => {
      // Verify that vector search also returns no results for the deleted content
      const searchResults = await vectorStoreService.search(
        testOrgId,
        "order #12345 customer@example.com",
        5,
      );

      // None of the results should contain the deleted customer's data
      const hasDeletedContent = searchResults.some(
        (r) =>
          r.content.includes("order #12345") ||
          r.content.includes("customer@example.com") ||
          r.content.includes("555-1234"),
      );
      expect(hasDeletedContent).toBe(false);
    });
  });
});
