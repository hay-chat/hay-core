#!/usr/bin/env ts-node

import { AppDataSource } from "../database/data-source";
import { vectorStoreService } from "../services/vector-store.service";
import { ConversationService } from "../services/conversation.service";
import { OrchestratorService } from "../services/orchestrator.service";
import { PlaybookService } from "../services/playbook.service";
import { AgentService } from "../services/agent.service";
import { MessageType } from "../database/entities/message.entity";

async function main() {
  console.log("🚀 Starting RAG system test...\n");

  // Initialize database
  await AppDataSource.initialize();
  console.log("✅ Database connected\n");

  // Initialize vector store
  await vectorStoreService.initialize();
  console.log("✅ Vector store initialized\n");

  // Use a test organization ID (you should have one in your database)
  const organizationId = "a63edd82-e683-4790-a9f7-890f6c9e87f5"; // Update this with your actual org ID

  // Add sample documents to the knowledge base
  console.log("📚 Adding sample documents to knowledge base...");
  
  const documents = [
    {
      content: "To add a constituent in our CRM system, navigate to the Constituents module from the main dashboard. Click on the 'Add New Constituent' button in the top right corner. Fill in the required fields including First Name, Last Name, Email, and Phone Number. Optional fields include Address, Date of Birth, and any custom tags. Click 'Save' to create the new constituent record. The system will automatically generate a unique ID for the constituent.",
      metadata: { source: "CRM User Guide", category: "constituent_management" }
    },
    {
      content: "Constituent records can be edited by clicking on the constituent's name in the list view. This opens the constituent detail page where you can modify any field. Remember to click 'Save Changes' after making updates. You can also add notes, activities, and relationships from the constituent detail page. All changes are tracked in the audit log.",
      metadata: { source: "CRM User Guide", category: "constituent_management" }
    },
    {
      content: "To search for constituents, use the search bar at the top of the Constituents module. You can search by name, email, phone number, or any custom field. Advanced search options allow filtering by tags, date ranges, and activity history. Use wildcards (*) for partial matches.",
      metadata: { source: "CRM User Guide", category: "search" }
    },
    {
      content: "Bulk operations on constituents: Select multiple constituents using the checkboxes in the list view. Use the 'Bulk Actions' dropdown to apply tags, export data, or send mass communications. Be careful with bulk delete operations as they cannot be undone.",
      metadata: { source: "CRM Admin Guide", category: "bulk_operations" }
    },
    {
      content: "For technical support, contact our help desk at support@example.com or call 1-800-HELP-NOW. Support hours are Monday through Friday, 9 AM to 6 PM EST. For urgent issues outside business hours, use the emergency support portal at support.example.com/emergency.",
      metadata: { source: "Support Documentation", category: "support" }
    }
  ];

  try {
    for (const doc of documents) {
      await vectorStoreService.addChunks(
        organizationId,
        null,
        [doc]
      );
    }
    console.log(`✅ Added ${documents.length} documents to knowledge base\n`);
  } catch (error) {
    console.error("Error adding documents:", error);
  }

  // Create services
  const conversationService = new ConversationService();
  const playbookService = new PlaybookService();
  const agentService = new AgentService();
  const orchestratorService = new OrchestratorService(
    conversationService,
    playbookService,
    agentService,
    vectorStoreService
  );

  // Create a test conversation
  console.log("💬 Creating test conversation...");
  const conversation = await conversationService.createConversation(organizationId, {
    title: "RAG Test Conversation",
    metadata: { test: true }
  });
  console.log(`✅ Created conversation: ${conversation.id}\n`);

  // Test queries
  const testQueries = [
    "How do I add a constituent?",
    "What are the support hours?",
    "How can I search for constituents?",
    "Tell me about bulk operations"
  ];

  for (const query of testQueries) {
    console.log(`\n📝 User: "${query}"`);
    
    // Add user message
    await conversationService.addMessage(conversation.id, organizationId, {
      content: query,
      type: MessageType.HUMAN_MESSAGE,
      sender: "user"
    });

    // Process with orchestrator
    await orchestratorService.processConversation(conversation.id, organizationId);
    
    // Get the response
    const messages = await conversationService.getMessages(conversation.id);
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.type === MessageType.AI_MESSAGE) {
      console.log(`🤖 Assistant: "${lastMessage.content.substring(0, 200)}..."`);
      
      if (lastMessage.metadata) {
        console.log(`   Metadata:`, {
          path: lastMessage.metadata.path,
          confidence: lastMessage.metadata.confidence,
          model: lastMessage.metadata.model
        });
      }
    }
  }

  // Get statistics
  console.log("\n📊 Knowledge Base Statistics:");
  const stats = await vectorStoreService.getStatistics(organizationId);
  console.log(`   Total embeddings: ${stats.totalEmbeddings}`);
  console.log(`   Total documents: ${stats.totalDocuments}`);
  console.log(`   Avg embeddings per document: ${stats.avgEmbeddingsPerDocument}`);

  console.log("\n✅ RAG system test completed!");
  
  // Close database connection
  await AppDataSource.destroy();
}

main().catch(error => {
  console.error("Test failed:", error);
  process.exit(1);
});