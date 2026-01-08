import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { vectorStoreService } from "../../services/vector-store.service";
import { ConversationService } from "../../services/conversation.service";
import type { VectorChunk } from "../../services/vector-store.service";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "../../database/entities/agent.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { Customer } from "../../database/entities/customer.entity";

describe("ConversationService - Cascade Delete Embeddings", () => {
  const testOrgId = "c5ce4567-e89b-12d3-a456-426614174000";
  const testAgentId = "a9e14567-e89b-12d3-a456-426614174000";
  const testCustomerId = "c0574567-e89b-12d3-a456-426614174000";
  let conversationService: ConversationService;

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
        name: "Conversation Service Test Organization",
        slug: "conv-service-test-org",
      });
      await orgRepo.save(testOrg);
    }

    // Create test agent
    const agentRepo = AppDataSource.getRepository(Agent);
    const existingAgent = await agentRepo.findOne({ where: { id: testAgentId } });
    if (!existingAgent) {
      const testAgent = agentRepo.create({
        id: testAgentId,
        name: "Test Agent",
        organization_id: testOrgId,
      });
      await agentRepo.save(testAgent);
    }

    // Create test customer
    const customerRepo = AppDataSource.getRepository(Customer);
    const existingCustomer = await customerRepo.findOne({ where: { id: testCustomerId } });
    if (!existingCustomer) {
      const testCustomer = customerRepo.create({
        id: testCustomerId,
        organization_id: testOrgId,
      });
      await customerRepo.save(testCustomer);
    }

    conversationService = new ConversationService();
  });

  afterAll(async () => {
    // Clean up test data
    await vectorStoreService.deleteByOrganizationId(testOrgId);

    const conversationRepo = AppDataSource.getRepository(Conversation);
    await conversationRepo.delete({ organization_id: testOrgId });

    const agentRepo = AppDataSource.getRepository(Agent);
    await agentRepo.delete({ id: testAgentId });

    const customerRepo = AppDataSource.getRepository(Customer);
    await customerRepo.delete({ id: testCustomerId });

    const orgRepo = AppDataSource.getRepository(Organization);
    await orgRepo.delete({ id: testOrgId });

    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("deleteConversation - Embedding Cascade", () => {
    /**
     * This test verifies that when a conversation is deleted,
     * all associated embeddings (linked via metadata) are also deleted.
     * This is critical for GDPR compliance.
     */
    it("should delete embeddings when conversation is deleted", async () => {
      // Create a conversation
      const conversation = await conversationService.createConversation(testOrgId, {
        title: "Test Conversation for Embedding Deletion",
        agentId: testAgentId,
        customer_id: testCustomerId,
      });

      // Add a message to the conversation
      const message = await conversationService.addMessage(
        conversation.id,
        testOrgId,
        {
          content: "Hello, I need help with my account",
          type: MessageType.CUSTOMER,
        },
      );

      // Add embeddings linked to the conversation via metadata
      const chunks: VectorChunk[] = [
        {
          content: "Customer message about account help",
          metadata: { conversationId: conversation.id, type: "conversation_embedding" },
        },
        {
          content: "Another embedding for same conversation",
          metadata: { conversationId: conversation.id, type: "conversation_embedding" },
        },
      ];
      await vectorStoreService.addChunks(testOrgId, null, chunks);

      // Add embeddings linked to the message via metadata
      const messageChunks: VectorChunk[] = [
        {
          content: "Embedding for specific message",
          metadata: { messageId: message.id, type: "message_embedding" },
        },
      ];
      await vectorStoreService.addChunks(testOrgId, null, messageChunks);

      // Verify embeddings exist before deletion
      const convEmbeddingsBefore = await vectorStoreService.findByConversationIds(
        testOrgId,
        [conversation.id],
      );
      expect(convEmbeddingsBefore.length).toBe(2);

      const msgEmbeddingsBefore = await vectorStoreService.findByMessageIds(
        testOrgId,
        [message.id],
      );
      expect(msgEmbeddingsBefore.length).toBe(1);

      // Delete the conversation
      const deleted = await conversationService.deleteConversation(testOrgId, conversation.id);
      expect(deleted).toBe(true);

      // Verify embeddings are deleted
      const convEmbeddingsAfter = await vectorStoreService.findByConversationIds(
        testOrgId,
        [conversation.id],
      );
      expect(convEmbeddingsAfter.length).toBe(0);

      const msgEmbeddingsAfter = await vectorStoreService.findByMessageIds(
        testOrgId,
        [message.id],
      );
      expect(msgEmbeddingsAfter.length).toBe(0);
    });

    it("should return false when deleting non-existent conversation", async () => {
      const deleted = await conversationService.deleteConversation(
        testOrgId,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(deleted).toBe(false);
    });

    it("should return false when organization ID does not match", async () => {
      // Create a conversation
      const conversation = await conversationService.createConversation(testOrgId, {
        title: "Test Org Mismatch",
        agentId: testAgentId,
        customer_id: testCustomerId,
      });

      // Try to delete with wrong org ID
      const deleted = await conversationService.deleteConversation(
        "00000000-0000-0000-0000-000000000000",
        conversation.id,
      );
      expect(deleted).toBe(false);

      // Clean up - delete with correct org ID
      await conversationService.deleteConversation(testOrgId, conversation.id);
    });

    it("should handle conversation with no embeddings gracefully", async () => {
      // Create a conversation without any embeddings
      const conversation = await conversationService.createConversation(testOrgId, {
        title: "Conversation Without Embeddings",
        agentId: testAgentId,
        customer_id: testCustomerId,
      });

      // Delete should succeed
      const deleted = await conversationService.deleteConversation(testOrgId, conversation.id);
      expect(deleted).toBe(true);
    });

    it("should delete conversation with multiple messages and their embeddings", async () => {
      // Create a conversation
      const conversation = await conversationService.createConversation(testOrgId, {
        title: "Multi-Message Conversation",
        agentId: testAgentId,
        customer_id: testCustomerId,
      });

      // Add multiple messages
      const message1 = await conversationService.addMessage(
        conversation.id,
        testOrgId,
        { content: "First message", type: MessageType.CUSTOMER },
      );
      const message2 = await conversationService.addMessage(
        conversation.id,
        testOrgId,
        { content: "Second message", type: MessageType.BOT_AGENT },
      );
      const message3 = await conversationService.addMessage(
        conversation.id,
        testOrgId,
        { content: "Third message", type: MessageType.CUSTOMER },
      );

      // Add embeddings for each message
      for (const msg of [message1, message2, message3]) {
        await vectorStoreService.addChunks(testOrgId, null, [
          {
            content: `Embedding for message: ${msg.content}`,
            metadata: { messageId: msg.id },
          },
        ]);
      }
      
      // Add embeddings linked only to the conversation (not messages)
      await vectorStoreService.addChunks(testOrgId, null, [
        {
          content: "Conversation-level embedding",
          metadata: { conversationId: conversation.id },
        },
      ]);

      // Verify all embeddings exist
      const allMessageIds = [message1.id, message2.id, message3.id];
      const embeddingsBefore = await vectorStoreService.findByMessageIds(testOrgId, allMessageIds);
      expect(embeddingsBefore.length).toBe(3);

      // Delete conversation
      const deleted = await conversationService.deleteConversation(testOrgId, conversation.id);
      expect(deleted).toBe(true);

      // Verify all embeddings are deleted
      const embeddingsAfter = await vectorStoreService.findByMessageIds(testOrgId, allMessageIds);
      expect(embeddingsAfter.length).toBe(0);

      const convEmbeddingsAfter = await vectorStoreService.findByConversationIds(
        testOrgId,
        [conversation.id],
      );
      expect(convEmbeddingsAfter.length).toBe(0);
    });
  });
});
