import { ConversationService } from "./conversation.service";
import { PlaybookService } from "./playbook.service";
import { AgentService } from "./agent.service";
import { VectorStoreService } from "./vector-store.service";
import { config } from "../config/env";

// Import orchestrator modules
import type { ExecutionResult } from "./orchestrator/types";
import { AgentRouting } from "./orchestrator/agent-routing";
import { PlanCreation } from "./orchestrator/plan-creation";
import { DocumentRetrieval } from "./orchestrator/document-retrieval";
import { PlaybookExecution } from "./orchestrator/playbook-execution";
import { ConversationManagement } from "./orchestrator/conversation-management";
import { MessageProcessing } from "./orchestrator/message-processing";
import { PlaybookHelpers } from "./orchestrator/playbook-helpers";
import { EnderManagement } from "./orchestrator/ender-management";

// Re-export types for backward compatibility
export type { OrchestrationPlan, ExecutionResult } from "./orchestrator/types";

export class OrchestratorService {
  private agentRouting: AgentRouting;
  private planCreation: PlanCreation;
  private documentRetrieval: DocumentRetrieval;
  private playbookExecution: PlaybookExecution;
  private conversationManagement: ConversationManagement;
  private messageProcessing: MessageProcessing;
  private playbookHelpers: PlaybookHelpers;
  private enderManagement: EnderManagement;

  constructor(
    private conversationService: ConversationService,
    private playbookService: PlaybookService,
    private agentService: AgentService,
    private vectorStoreService: VectorStoreService
  ) {
    // Initialize orchestrator modules
    this.agentRouting = new AgentRouting(agentService, conversationService);
    this.planCreation = new PlanCreation(playbookService, vectorStoreService);
    this.documentRetrieval = new DocumentRetrieval(vectorStoreService);
    this.playbookExecution = new PlaybookExecution(playbookService, vectorStoreService, agentService);
    this.conversationManagement = new ConversationManagement(conversationService);
    this.messageProcessing = new MessageProcessing(conversationService);
    this.playbookHelpers = new PlaybookHelpers(playbookService);
    this.enderManagement = new EnderManagement(conversationService, this.playbookHelpers);
  }

  async processConversation(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    console.log(`[Orchestrator] Processing conversation ${conversationId}`);
    
    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId
    );

    if (!conversation) {
      console.log(`[Orchestrator] Conversation ${conversationId} not found`);
      return;
    }
    
    if (conversation.status !== "open") {
      console.log(`[Orchestrator] Conversation ${conversationId} status is ${conversation.status}, skipping`);
      return;
    }

    // Check if cooldown has expired
    if (
      conversation.cooldown_until &&
      new Date(conversation.cooldown_until) > new Date()
    ) {
      const now = new Date();
      const cooldownEnd = new Date(conversation.cooldown_until);
      const remainingMs = cooldownEnd.getTime() - now.getTime();
      console.log(`[Orchestrator] Conversation ${conversationId} is in cooldown:
        - Now: ${now.toISOString()}
        - Cooldown until: ${cooldownEnd.toISOString()}
        - Remaining: ${Math.round(remainingMs / 1000)} seconds`);
      return;
    }

    // IMMEDIATELY set a cooldown to prevent duplicate processing
    // This prevents race conditions where multiple workers pick up the same conversation
    const processingCooldown = new Date();
    processingCooldown.setSeconds(processingCooldown.getSeconds() + 30); // 30 second processing window
    
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        cooldown_until: processingCooldown,
        needs_processing: false // Mark as being processed
      }
    );
    
    console.log(`[Orchestrator] Set processing lock until ${processingCooldown.toISOString()}`);

    try {
      // Step 1: Agent Routing (if needed)
      let agentId = conversation.agent_id;
      if (!agentId) {
        console.log(`[Orchestrator] No agent assigned, routing...`);
        agentId = await this.agentRouting.routeAgent(organizationId);
        if (!agentId) {
          console.log(`[Orchestrator] No available agents`);
          await this.agentRouting.handleNoAgent(conversationId, organizationId);
          return;
        }
        console.log(`[Orchestrator] Assigned agent ${agentId} to conversation`);
        await this.agentRouting.assignAgent(conversationId, organizationId, agentId);
      } else {
        console.log(`[Orchestrator] Using existing agent ${agentId}`);
      }

      // Get unprocessed user messages
      const { messages: unprocessedUserMessages, combinedMessage: combinedUserMessage } = 
        await this.messageProcessing.getUnprocessedUserMessages(conversationId, organizationId);
      
      if (unprocessedUserMessages.length === 0) {
        return;
      }

      // Get all messages for context
      const messages = await this.conversationService.getLastMessages(
        conversationId,
        organizationId,
        20
      );

      // Step 2: Planning - determine path
      console.log(`[Orchestrator] Creating execution plan...`);
      const plan = await this.planCreation.createPlan(
        combinedUserMessage,
        conversation,
        organizationId
      );
      console.log(`[Orchestrator] Plan created: path=${plan.path}, agentId=${plan.agentId}, playbookId=${plan.playbookId}`);

      // Step 3: Execution
      console.log(`[Orchestrator] Starting execution...`);
      const startTime = Date.now();
      let result: ExecutionResult;

      if (plan.path === "docqa") {
        console.log(`[Orchestrator] Executing document retrieval...`);
        result = await this.documentRetrieval.execute(
          combinedUserMessage,
          organizationId
        );
      } else {
        console.log(`[Orchestrator] Executing playbook ${plan.playbookId}...`);
        result = await this.playbookExecution.execute(
          plan,
          conversation,
          messages,
          organizationId,
          combinedUserMessage
        );
      }

      // Calculate latency
      const latency = Date.now() - startTime;
      console.log(`[Orchestrator] Execution completed in ${latency}ms`);

      // Step 4: Save assistant message (no longer adding hardcoded enders)
      await this.messageProcessing.saveAssistantMessage(
        conversationId,
        organizationId,
        result.content,
        result.metadata,
        latency,
        plan.path
      );

      // Step 5: Check if user wants to close the conversation
      await this.conversationManagement.detectResolution(
        conversationId,
        organizationId,
        combinedUserMessage
      );

      // Step 6: Update conversation status if needed
      await this.messageProcessing.updateConversationStatus(
        conversationId,
        organizationId,
        result.setStatus
      );

      // Generate title after 2 user messages
      await this.conversationManagement.generateTitle(conversationId, organizationId);

      // Clear cooldown since we're done processing
      await this.messageProcessing.clearCooldownAndMarkProcessed(
        conversationId,
        organizationId
      );
      
      console.log(`[Orchestrator] ✅ Conversation ${conversationId} processing complete`);
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error processing conversation ${conversationId}:`, error);
      // Clear cooldown on error so conversation can be retried
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          cooldown_until: null,
          needs_processing: true // Re-enable processing on error
        }
      );
      await this.messageProcessing.handleError(conversationId, organizationId, error);
    }
  }




  async detectResolution(
    conversationId: string,
    organizationId: string,
    userMessage: string
  ): Promise<void> {
    await this.conversationManagement.detectResolution(
      conversationId,
      organizationId,
      userMessage
    );
  }

  async checkInactiveConversations(organizationId: string): Promise<void> {
    // First check for conversations that need inactivity reminders
    await this.checkAndSendInactivityReminders(organizationId);
    
    // Then check for conversations that should be closed due to inactivity
    await this.conversationManagement.checkInactiveConversations(organizationId);
  }

  private async checkAndSendInactivityReminders(organizationId: string): Promise<void> {
    console.log(`[Orchestrator] Checking for conversations needing inactivity reminders`);
    
    try {
      // Get all open conversations
      const allConversations = await this.conversationService.getConversations(
        organizationId
      );
      const openConversations = allConversations.filter(
        (conv) => conv.status === "open"
      );

      const inactivityThreshold = config.conversation.inactivityInterval;
      
      for (const conversation of openConversations) {
        const needsReminder = await this.enderManagement.checkForInactivityReminder(
          conversation.id,
          organizationId,
          inactivityThreshold
        );

        if (needsReminder) {
          await this.enderManagement.sendInactivityReminder(
            conversation.id,
            organizationId
          );
        }
      }
    } catch (error) {
      console.error(`[Orchestrator] Error checking inactivity reminders:`, error);
    }
  }

  async generateConversationTitle(
    conversationId: string,
    organizationId: string,
    force: boolean = false
  ): Promise<void> {
    await this.conversationManagement.generateTitle(conversationId, organizationId, force);
  }
}
