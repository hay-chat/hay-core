import { ConversationRepository } from "../repositories/conversation.repository";
import { OrchestratorService } from "../services/orchestrator.service";
import { ConversationService } from "../services/conversation.service";
import { PlaybookService } from "../services/playbook.service";
import { AgentService } from "../services/agent.service";
import { VectorStoreService } from "../services/vector-store.service";
import { AppDataSource } from "../database/data-source";

export class OrchestratorWorker {
  private orchestratorService?: OrchestratorService;
  private conversationRepository?: ConversationRepository;
  private intervalId: NodeJS.Timeout | null = null;
  private inactivityCheckIntervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private initialized = false;

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Only initialize if database is connected
    if (!AppDataSource.isInitialized) {
      console.warn("Database not initialized, skipping orchestrator initialization");
      return;
    }

    try {
      const conversationService = new ConversationService();
      const playbookService = new PlaybookService();
      const agentService = new AgentService();
      const vectorStoreService = new VectorStoreService();

      this.orchestratorService = new OrchestratorService(
        conversationService,
        playbookService,
        agentService,
        vectorStoreService
      );
      
      // Create repository instance - now safe because DataSource is initialized
      this.conversationRepository = new ConversationRepository();
      this.initialized = true;
      console.log("[Worker] Orchestrator worker initialized successfully");
    } catch (error) {
      console.error("Failed to initialize orchestrator worker:", error);
      this.initialized = false;
    }
  }

  start(intervalMs: number = 1000): void {
    if (this.intervalId) {
      console.log("Orchestrator worker is already running");
      return;
    }

    console.log(`Starting orchestrator worker with ${intervalMs}ms interval`);
    
    this.intervalId = setInterval(async () => {
      if (!this.isProcessing) {
        await this.tick();
      }
    }, intervalMs);

    // Start inactivity check every 5 minutes
    this.inactivityCheckIntervalId = setInterval(async () => {
      await this.checkInactivity();
    }, 5 * 60 * 1000); // 5 minutes

    // Run immediately
    this.tick();
    // Run inactivity check immediately as well
    this.checkInactivity();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("Orchestrator worker stopped");
    }
    if (this.inactivityCheckIntervalId) {
      clearInterval(this.inactivityCheckIntervalId);
      this.inactivityCheckIntervalId = null;
      console.log("Inactivity check stopped");
    }
  }

  private async tick(): Promise<void> {
    this.isProcessing = true;

    try {
      // Initialize if not already done
      await this.initialize();

      if (!this.initialized || !this.conversationRepository || !this.orchestratorService) {
        // Skip if not initialized
        return;
      }

      // Find conversations ready for processing
      const conversations = await this.conversationRepository.findReadyForProcessing();
      
      if (conversations.length > 0) {
        console.log(`Processing ${conversations.length} conversations`);
      }

      // Process each conversation
      for (const conversation of conversations) {
        try {
          await this.orchestratorService.processConversation(
            conversation.id,
            conversation.organization_id
          );
        } catch (error) {
          console.error(`Error processing conversation ${conversation.id}:`, error);
        }
      }
    } catch (error) {
      console.error("Orchestrator tick error:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async checkInactivity(): Promise<void> {
    try {
      // Initialize if not already done
      await this.initialize();

      if (!this.initialized || !this.conversationRepository || !this.orchestratorService) {
        // Skip if not initialized
        return;
      }

      console.log("[Worker] Running inactivity check across all organizations");

      // Get all open conversations to find unique organization IDs
      const allOpenConversations = await this.conversationRepository.findAllOpenConversations();
      const organizationIds = [...new Set(allOpenConversations.map(c => c.organization_id))];

      console.log(`[Worker] Found ${organizationIds.length} organizations with open conversations`);

      // Check inactive conversations for each organization
      for (const orgId of organizationIds) {
        try {
          await this.orchestratorService.checkInactiveConversations(orgId);
        } catch (error) {
          console.error(`[Worker] Error checking inactive conversations for org ${orgId}:`, error);
        }
      }
    } catch (error) {
      console.error("[Worker] Inactivity check error:", error);
    }
  }
}

// Export singleton instance
export const orchestratorWorker = new OrchestratorWorker();