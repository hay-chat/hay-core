import { ConversationService } from "./conversation.service";
import { PlaybookService } from "./playbook.service";
import { AgentService } from "./agent.service";
import { VectorStoreService } from "./vector-store.service";
import { config } from "../config/env";
import { getUTCNow, addMilliseconds, formatUTC } from "../utils/date.utils";
import { v4 as uuidv4 } from "uuid";
import * as os from "os";
import { MessageType } from "../database/entities/message.entity";

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
    // Initialize orchestrator modules with Context Layer support
    this.agentRouting = new AgentRouting(agentService, conversationService, playbookService);
    this.planCreation = new PlanCreation(playbookService, vectorStoreService, conversationService, agentService);
    this.documentRetrieval = new DocumentRetrieval(vectorStoreService, conversationService, agentService, playbookService);
    this.playbookExecution = new PlaybookExecution(playbookService, vectorStoreService, agentService, conversationService);
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
    
    // Generate a unique identifier for this server instance
    const instanceId = `${os.hostname()}-${process.pid}-${uuidv4()}`;
    
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

    // Check if conversation is already being processed by another instance
    const now = getUTCNow();
    if (
      conversation.processing_locked_until &&
      new Date(conversation.processing_locked_until) > now
    ) {
      const lockEnd = new Date(conversation.processing_locked_until);
      const remainingMs = lockEnd.getTime() - now.getTime();
      console.log(`[Orchestrator] Conversation ${conversationId} is locked by ${conversation.processing_locked_by}:
        - Now: ${formatUTC(now)}
        - Locked until: ${formatUTC(lockEnd)}
        - Remaining: ${Math.round(remainingMs / 1000)} seconds`);
      return;
    }

    // Check if cooldown has expired (backward compatibility)
    if (
      conversation.cooldown_until &&
      new Date(conversation.cooldown_until) > now
    ) {
      const cooldownEnd = new Date(conversation.cooldown_until);
      const remainingMs = cooldownEnd.getTime() - now.getTime();
      console.log(`[Orchestrator] Conversation ${conversationId} is in cooldown:
        - Now: ${formatUTC(now)}
        - Cooldown until: ${formatUTC(cooldownEnd)}
        - Remaining: ${Math.round(remainingMs / 1000)} seconds`);
      return;
    }

    // IMMEDIATELY set a processing lock to prevent duplicate processing
    // This prevents race conditions where multiple workers pick up the same conversation
    const processingLockUntil = addMilliseconds(now, 30000); // 30 second processing window
    
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        processing_locked_until: processingLockUntil,
        processing_locked_by: instanceId,
        needs_processing: false // Mark as being processed
      }
    );
    
    console.log(`[Orchestrator] Set processing lock until ${processingLockUntil.toISOString()} by instance ${instanceId}`);

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
        console.log(`[Orchestrator] No unprocessed customer messages found - clearing processing lock`);
        // Clear processing lock since there's nothing to process
        await this.clearProcessingLock(conversationId, organizationId);
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
        organizationId,
        messages
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

      // Step 4: Check if user wants to close the conversation BEFORE processing
      // This allows us to detect closure intent early and avoid unnecessary processing
      const conversationClosed = await this.detectAndHandleClosureIntent(
        conversationId,
        organizationId,
        combinedUserMessage
      );
      
      // If conversation was closed, skip saving the AI response
      if (!conversationClosed) {
        // Step 5: Save assistant message (no longer adding hardcoded enders)
        await this.messageProcessing.saveAssistantMessage(
          conversationId,
          organizationId,
          result.content,
          result.metadata,
          latency,
          plan.path
        );
      }

      // Step 6: Update conversation status if needed
      await this.messageProcessing.updateConversationStatus(
        conversationId,
        organizationId,
        result.setStatus
      );

      // Generate title after 2 user messages
      await this.conversationManagement.generateTitle(conversationId, organizationId);

      // Clear processing lock and cooldown since we're done processing
      await this.clearProcessingLock(conversationId, organizationId);
      
      console.log(`[Orchestrator] ✅ Conversation ${conversationId} processing complete`);
    } catch (error) {
      console.error(`[Orchestrator] ❌ Error processing conversation ${conversationId}:`, error);
      // Clear processing lock on error so conversation can be retried
      await this.conversationService.updateConversation(
        conversationId,
        organizationId,
        {
          processing_locked_until: null,
          processing_locked_by: null,
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
  
  private async detectAndHandleClosureIntent(
    conversationId: string,
    organizationId: string,
    userMessage: string
  ): Promise<boolean> {
    try {
      // Use LLM to detect closure intent
      const { Hay } = await import("./hay.service");
      Hay.init();

      const systemPrompt = `You are a conversation closure detector. Determine if the user wants to end the conversation immediately.

Examples of immediate closure intent:
- "Bye", "Goodbye", "See you later"
- "Thanks, that's all I needed"
- "Problem solved, thanks"
- "No thanks, nothing else"

Examples that are NOT immediate closure:
- General greetings like "Hi", "Good morning"
- Questions or requests for help
- Complaints or issues needing resolution
- "Thank you" followed by more questions

Respond with JSON: {"close_now": true/false, "positive_resolution": true/false, "reasoning": "explanation"}`;

      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        `User message: ${userMessage}`
      );

      const analysis = JSON.parse(response.content);
      
      if (analysis.close_now) {
        console.log(`[Orchestrator] LLM detected closure intent: "${userMessage}"`);
        
        const finalStatus = "resolved";
        const reason = analysis.positive_resolution ? "customer_satisfied" : "user_indicated_completion";
        
        // Send a goodbye message before closing
        await this.conversationService.addMessage(conversationId, organizationId, {
          content: "Thank you for contacting us! Have a great day! 👋",
          type: MessageType.BOT_AGENT,
          sender: "assistant",
          metadata: {
            reason: "conversation_closure",
            ai_reasoning: analysis.reasoning
          }
        });
        
        // Close the conversation
        await this.conversationService.updateConversation(
          conversationId,
          organizationId,
          {
            status: finalStatus,
            ended_at: getUTCNow(),
            resolution_metadata: {
              resolved: true,
              confidence: 0.95,
              reason
            },
          }
        );
        
        // Generate title for closed conversation
        await this.conversationManagement.generateTitle(conversationId, organizationId, true);
        
        return true; // Conversation was closed
      }
      
      // For non-obvious cases, still run detection but after response
      await this.conversationManagement.detectResolution(
        conversationId,
        organizationId,
        userMessage
      );
      
      return false; // Conversation continues
    } catch (error) {
      console.error("[Orchestrator] Error in closure intent detection:", error);
      
      // Fallback to resolution detection
      await this.conversationManagement.detectResolution(
        conversationId,
        organizationId,
        userMessage
      );
      
      return false;
    }
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

  private async clearProcessingLock(
    conversationId: string,
    organizationId: string
  ): Promise<void> {
    await this.conversationService.updateConversation(
      conversationId,
      organizationId,
      {
        processing_locked_until: null,
        processing_locked_by: null,
        cooldown_until: null,
        needs_processing: false,
        last_processed_at: getUTCNow(),
      }
    );
  }
}
