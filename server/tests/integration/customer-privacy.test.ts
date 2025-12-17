import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "@server/database/data-source";
import { Customer } from "@server/database/entities/customer.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { Organization } from "@server/entities/organization.entity";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import { privacyService } from "@server/services/privacy.service";
import { vectorStoreService } from "@server/services/vector-store.service";
import { redisService } from "@server/services/redis.service";
import { MessageRepository } from "@server/repositories/message.repository";

describe("Customer Privacy DSAR Integration Tests", () => {
  let testOrg: Organization;
  let testCustomer: Customer;
  let testConversation: Conversation;
  const testEmail = "customer-privacy-test@example.com";
  const testOrgId = "a0000001-0000-4000-8000-000000000001"; // Valid UUID v4 format

  beforeAll(async () => {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Initialize Redis
    if (!redisService.isConnected()) {
      await redisService.initialize();
    }

    // Initialize VectorStore
    if (!vectorStoreService.initialized) {
      await vectorStoreService.initialize();
    }
  });

  afterEach(async () => {
    // Clean up test data after each test
    const customerRepo = AppDataSource.getRepository(Customer);
    const conversationRepo = AppDataSource.getRepository(Conversation);
    const messageRepo = AppDataSource.getRepository(Message);
    const orgRepo = AppDataSource.getRepository(Organization);
    const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
    const embeddingRepo = AppDataSource.getRepository("Embedding");

    // Delete in correct order
    await privacyRequestRepo.delete({ email: testEmail });

    // Delete embeddings for this org
    await embeddingRepo.delete({ organizationId: testOrgId });

    // Get all conversations for this org to clean up messages
    const conversations = await conversationRepo.find({
      where: { organization_id: testOrgId },
    });

    // Delete messages
    for (const conv of conversations) {
      await messageRepo.delete({ conversation_id: conv.id });
    }

    await conversationRepo.delete({ organization_id: testOrgId });
    await customerRepo.delete({ organization_id: testOrgId });
    await orgRepo.delete({ id: testOrgId });
  });

  afterAll(async () => {
    // Clean up database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }

    // Clean up Redis
    await redisService.shutdown();
  });

  beforeEach(async () => {
    // Clean up test data
    const customerRepo = AppDataSource.getRepository(Customer);
    const conversationRepo = AppDataSource.getRepository(Conversation);
    const messageRepo = AppDataSource.getRepository(Message);
    const orgRepo = AppDataSource.getRepository(Organization);
    const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
    const embeddingRepo = AppDataSource.getRepository("Embedding");

    // Delete in correct order - clean up everything for the test org
    await privacyRequestRepo.delete({ email: testEmail });

    // Delete embeddings for this org
    await embeddingRepo.delete({ organizationId: testOrgId });

    // Delete all messages and conversations for this org ID
    const conversations = await conversationRepo.find({
      where: { organization_id: testOrgId },
    });
    for (const conv of conversations) {
      await messageRepo.delete({ conversation_id: conv.id });
    }
    await conversationRepo.delete({ organization_id: testOrgId });
    await customerRepo.delete({ email: testEmail });
    await orgRepo.delete({ id: testOrgId });

    // Create test organization with unique slug to avoid conflicts
    testOrg = orgRepo.create({
      id: testOrgId,
      name: "Customer Privacy Test Org",
      slug: `customer-privacy-test-${Date.now()}`,
      isActive: true,
      limits: {
        maxUsers: 10,
        maxDocuments: 100,
        maxApiKeys: 10,
        maxJobs: 50,
        maxStorageGb: 1,
      },
    });
    await orgRepo.save(testOrg);

    // Create test customer
    testCustomer = customerRepo.create({
      organization_id: testOrgId,
      email: testEmail,
      phone: "+1234567890",
      name: "Test Customer",
      external_id: "test-customer-123",
      external_metadata: { source: "test", tier: "premium" },
    });
    await customerRepo.save(testCustomer);

    // Create test conversation
    testConversation = conversationRepo.create({
      organization_id: testOrgId,
      customer_id: testCustomer.id,
      title: "Test Conversation",
      channel: "web",
      status: "open",
      metadata: { test: true },
    });
    await conversationRepo.save(testConversation);

    // Create test messages using MessageRepository
    const messageRepository = new MessageRepository();
    const message1 = await messageRepository.create({
      conversation_id: testConversation.id,
      type: "Customer",
      direction: "in",
      content: "Hello, I need help with order #12345",
      sender: "Test Customer",
      sourceId: "webchat",
    });
    const message2 = await messageRepository.create({
      conversation_id: testConversation.id,
      type: "BotAgent",
      direction: "out",
      content: "I can help you with that order",
      sender: "AI Assistant",
      sourceId: "webchat",
    });
    const messages = [message1, message2];

    // Create test embeddings for the conversation
    const chunks = [
      {
        content: "Hello, I need help with order #12345",
        metadata: {
          conversationId: testConversation.id,
          messageId: messages[0].id,
          customerId: testCustomer.id,
        },
      },
      {
        content: "I can help you with that order",
        metadata: {
          conversationId: testConversation.id,
          messageId: messages[1].id,
        },
      },
    ];
    await vectorStoreService.addChunks(testOrgId, null, chunks);
  });

  describe("Customer Data Export Flow", () => {
    it("should complete end-to-end customer export request", async () => {
      // Step 1: Request export
      const requestResult = await privacyService.requestCustomerExport(
        testOrgId,
        { type: "email", value: testEmail },
      );

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.expiresAt).toBeInstanceOf(Date);
      expect(requestResult.customerFound).toBe(true);

      // Verify privacy request was created
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({
        where: { id: requestResult.requestId },
      });

      expect(request).toBeDefined();
      expect(request?.email).toBe(testEmail);
      expect(request?.type).toBe("export");
      expect(request?.subjectType).toBe("customer");
      expect(request?.status).toBe("pending_verification");
      expect(request?.customerId).toBe(testCustomer.id);
      expect(request?.organizationId).toBe(testOrgId);
    }, 15000);

    it("should collect complete customer data including embeddings", async () => {
      const exportData = await (privacyService as any).collectCustomerData(
        testCustomer.id,
        testOrgId,
      );

      expect(exportData).toBeDefined();
      expect(exportData.exportDate).toBeDefined();
      expect(exportData.dataSubject.customerId).toBe(testCustomer.id);
      expect(exportData.dataSubject.organizationId).toBe(testOrgId);

      // Verify profile data
      expect(exportData.personalData.profile).toBeDefined();
      expect(exportData.personalData.profile.email).toBe(testEmail);
      expect(exportData.personalData.profile.phone).toBe("+1234567890");
      expect(exportData.personalData.profile.name).toBe("Test Customer");
      expect(exportData.personalData.profile.externalId).toBe("test-customer-123");

      // Verify conversations
      expect(exportData.personalData.conversations).toBeInstanceOf(Array);
      expect(exportData.personalData.conversations.length).toBeGreaterThan(0);
      const conversation = exportData.personalData.conversations[0];
      expect(conversation.id).toBe(testConversation.id);
      expect(conversation.messages).toBeInstanceOf(Array);
      // Expect at least our 2 test messages (service may add system messages)
      expect(conversation.messages.length).toBeGreaterThanOrEqual(2);

      // Verify embeddings are included
      expect(exportData.personalData.embeddings).toBeInstanceOf(Array);
      expect(exportData.personalData.embeddings.length).toBeGreaterThan(0);
      const embedding = exportData.personalData.embeddings[0];
      expect(embedding.content).toBeDefined();
      expect(embedding.metadata).toBeDefined();
      expect(embedding.metadata.conversationId).toBe(testConversation.id);

      // Verify statistics
      expect(exportData.personalData.statistics).toBeDefined();
      expect(exportData.personalData.statistics.totalConversations).toBe(1);
      // Expect at least our 2 test messages (service may add system messages)
      expect(exportData.personalData.statistics.totalMessages).toBeGreaterThanOrEqual(2);
      expect(exportData.personalData.statistics.totalEmbeddings).toBeGreaterThan(0);
    }, 15000);

    it("should handle customer not found gracefully", async () => {
      // When customer not found, the service throws an error
      await expect(
        privacyService.requestCustomerExport(
          testOrgId,
          { type: "email", value: "nonexistent@example.com" },
        )
      ).rejects.toThrow();
    }, 10000);

    it("should support phone number identifier", async () => {
      const requestResult = await privacyService.requestCustomerExport(
        testOrgId,
        { type: "phone", value: "+1234567890" },
      );

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.customerFound).toBe(true);
    }, 10000);

    it("should support external ID identifier", async () => {
      const requestResult = await privacyService.requestCustomerExport(
        testOrgId,
        { type: "externalId", value: "test-customer-123" },
      );

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.customerFound).toBe(true);
    }, 10000);
  });

  describe("Customer Data Deletion Flow", () => {
    it("should complete end-to-end customer deletion request", async () => {
      // Step 1: Request deletion
      const requestResult = await privacyService.requestCustomerDeletion(
        testOrgId,
        { type: "email", value: testEmail },
      );

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.expiresAt).toBeInstanceOf(Date);

      // Verify privacy request was created
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({
        where: { id: requestResult.requestId },
      });

      expect(request).toBeDefined();
      expect(request?.email).toBe(testEmail);
      expect(request?.type).toBe("deletion");
      expect(request?.subjectType).toBe("customer");
      expect(request?.status).toBe("pending_verification");
      expect(request?.customerId).toBe(testCustomer.id);
    }, 15000);

    it("should properly delete customer data including embeddings", async () => {
      // Verify embeddings exist before deletion
      const embeddingsBeforeDeletion = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversation.id],
      );
      expect(embeddingsBeforeDeletion.length).toBeGreaterThan(0);

      // Execute deletion
      await (privacyService as any).executeCustomerDeletion(testCustomer.id, testOrgId);

      // Verify customer was deleted
      const customerRepo = AppDataSource.getRepository(Customer);
      const deletedCustomer = await customerRepo.findOne({
        where: { id: testCustomer.id },
      });
      expect(deletedCustomer).toBeNull();

      // Verify conversations were anonymized
      const conversationRepo = AppDataSource.getRepository(Conversation);
      const anonymizedConversation = await conversationRepo.findOne({
        where: { id: testConversation.id },
      });
      expect(anonymizedConversation).toBeDefined();
      expect(anonymizedConversation?.customer_id).toBeNull();
      expect(anonymizedConversation?.title).toBe("[deleted]");

      // Verify messages were anonymized
      const messageRepo = AppDataSource.getRepository(Message);
      const messages = await messageRepo.find({
        where: { conversation_id: testConversation.id },
      });
      // Privacy service may create a deletion notification message, so we expect at least 2 messages
      expect(messages.length).toBeGreaterThanOrEqual(2);
      messages.forEach((msg) => {
        expect(msg.content).toBe("[deleted]");
        expect(msg.sender).toBe("[deleted]");
        expect(msg.metadata).toBeNull();
      });

      // Verify embeddings were deleted (CRITICAL GDPR TEST)
      const embeddingsAfterDeletion = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversation.id],
      );
      expect(embeddingsAfterDeletion.length).toBe(0);

      // Verify semantic search returns nothing
      const searchResults = await vectorStoreService.search(testOrgId, "order #12345", 10);
      const hasCustomerData = searchResults.some((r) =>
        r.content.includes("order #12345"),
      );
      expect(hasCustomerData).toBe(false);
    }, 20000);

    it("should fail deletion request for non-existent customer", async () => {
      await expect(
        privacyService.requestCustomerDeletion(
          testOrgId,
          { type: "email", value: "nonexistent@example.com" },
        ),
      ).rejects.toThrow("No customer found with this identifier");
    }, 10000);
  });

  describe("Customer Data Traversal", () => {
    it("should traverse complete data graph: customer → conversations → messages → embeddings", async () => {
      const exportData = await (privacyService as any).collectCustomerData(
        testCustomer.id,
        testOrgId,
      );

      // Verify complete traversal
      expect(exportData.personalData.profile).toBeDefined(); // Customer
      expect(exportData.personalData.conversations).toBeInstanceOf(Array); // Conversations
      expect(exportData.personalData.conversations[0].messages).toBeInstanceOf(Array); // Messages
      expect(exportData.personalData.embeddings).toBeInstanceOf(Array); // Embeddings

      // Verify embeddings link back to conversations
      const embedding = exportData.personalData.embeddings[0];
      expect(embedding.metadata.conversationId).toBe(testConversation.id);

      // Verify all data is customer-specific
      expect(exportData.dataSubject.customerId).toBe(testCustomer.id);
    }, 15000);

    it("should handle customer with multiple conversations", async () => {
      // Create additional conversations
      const conversationRepo = AppDataSource.getRepository(Conversation);
      const conversation2 = conversationRepo.create({
        organization_id: testOrgId,
        customer_id: testCustomer.id,
        title: "Second Conversation",
        channel: "email",
        status: "closed",
      });
      await conversationRepo.save(conversation2);

      const exportData = await (privacyService as any).collectCustomerData(
        testCustomer.id,
        testOrgId,
      );

      expect(exportData.personalData.conversations.length).toBe(2);
      expect(exportData.personalData.statistics.totalConversations).toBe(2);
    }, 15000);

    it("should handle customer with no conversations", async () => {
      // Create customer without conversations
      const customerRepo = AppDataSource.getRepository(Customer);
      const emptyCustomer = customerRepo.create({
        organization_id: testOrgId,
        email: "empty@example.com",
        name: "Empty Customer",
      });
      await customerRepo.save(emptyCustomer);

      const exportData = await (privacyService as any).collectCustomerData(
        emptyCustomer.id,
        testOrgId,
      );

      expect(exportData.personalData.conversations).toBeInstanceOf(Array);
      expect(exportData.personalData.conversations.length).toBe(0);
      expect(exportData.personalData.embeddings.length).toBe(0);
      expect(exportData.personalData.statistics.totalConversations).toBe(0);
      expect(exportData.personalData.statistics.totalMessages).toBe(0);
      expect(exportData.personalData.statistics.totalEmbeddings).toBe(0);

      // Cleanup
      await customerRepo.delete({ id: emptyCustomer.id });
    }, 15000);
  });

  describe("GDPR Compliance - No Orphaned Data", () => {
    it("should ensure no embeddings remain after deletion", async () => {
      const conversationId = testConversation.id;
      const customerId = testCustomer.id;

      // Delete customer
      await (privacyService as any).executeCustomerDeletion(customerId, testOrgId);

      // Verify no embeddings by conversation ID
      const embeddingsByConv = await vectorStoreService.findByConversationIds(
        testOrgId,
        [conversationId],
      );
      expect(embeddingsByConv.length).toBe(0);

      // Verify no embeddings in search results
      const searchResults = await vectorStoreService.search(testOrgId, "help", 100);
      const hasOrphanedData = searchResults.some(
        (r) => r.metadata.conversationId === conversationId,
      );
      expect(hasOrphanedData).toBe(false);
    }, 20000);

    it("should verify embeddings count matches deletion count", async () => {
      // Count embeddings before deletion
      const embeddingsBefore = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversation.id],
      );
      const countBefore = embeddingsBefore.length;
      expect(countBefore).toBeGreaterThan(0);

      // Execute deletion
      await (privacyService as any).executeCustomerDeletion(testCustomer.id, testOrgId);

      // Count embeddings after deletion
      const embeddingsAfter = await vectorStoreService.findByConversationIds(
        testOrgId,
        [testConversation.id],
      );
      const countAfter = embeddingsAfter.length;

      expect(countAfter).toBe(0);
      expect(countBefore - countAfter).toBe(countBefore); // All deleted
    }, 20000);
  });

  describe("Export Format Verification", () => {
    it("should include all required fields in export", async () => {
      const exportData = await (privacyService as any).collectCustomerData(
        testCustomer.id,
        testOrgId,
      );

      // Verify export metadata
      expect(exportData.exportDate).toBeDefined();
      expect(exportData.exportVersion).toBe("2.0");

      // Verify data subject
      expect(exportData.dataSubject.customerId).toBe(testCustomer.id);
      expect(exportData.dataSubject.organizationId).toBe(testOrgId);

      // Verify personal data structure
      expect(exportData.personalData).toHaveProperty("profile");
      expect(exportData.personalData).toHaveProperty("conversations");
      expect(exportData.personalData).toHaveProperty("embeddings");
      expect(exportData.personalData).toHaveProperty("statistics");
    }, 15000);

    it("should include embedding metadata with source", async () => {
      const exportData = await (privacyService as any).collectCustomerData(
        testCustomer.id,
        testOrgId,
      );

      const embedding = exportData.personalData.embeddings[0];
      expect(embedding).toHaveProperty("id");
      expect(embedding).toHaveProperty("content");
      expect(embedding).toHaveProperty("metadata");
      expect(embedding).toHaveProperty("createdAt");
      expect(embedding).toHaveProperty("source");
      expect(["conversation", "message"]).toContain(embedding.source);
    }, 15000);
  });
});
