import { PlaybookService } from "../playbook.service";
import { IntentDetector } from "./intent-detector";
import type { IntentAnalysis } from "./types";
import { Playbook, PlaybookStatus } from "../../database/entities/playbook.entity";

/**
 * Matches user messages to appropriate playbooks dynamically.
 * Evaluates intents and playbook triggers for each message.
 */
export class PlaybookMatcher {
  private intentDetector: IntentDetector;

  /**
   * Creates a new PlaybookMatcher instance.
   * @param playbookService - Service for managing playbooks
   */
  constructor(
    private playbookService: PlaybookService
  ) {
    this.intentDetector = new IntentDetector();
  }

  /**
   * Selects the best matching playbook for a user message.
   * Uses AI to evaluate all playbooks and select the best match.
   * @param userMessage - The user's message
   * @param organizationId - The organization ID
   * @param conversationHistory - Optional conversation context
   * @param currentPlaybookId - Currently active playbook (if any)
   * @returns Selected playbook and intent analysis
   */
  async selectPlaybook(
    userMessage: string,
    organizationId: string,
    conversationHistory?: string,
    currentPlaybookId?: string | null
  ): Promise<{
    playbook: Playbook | null;
    intentAnalysis: IntentAnalysis;
    switched: boolean;
    confidence?: number;
    reasoning?: string;
  }> {
    console.log(`[PlaybookMatcher] Analyzing message for playbook selection`);

    // Step 1: Detect intents from the user message (for backwards compatibility)
    const intentAnalysis = await this.intentDetector.detectIntents(
      userMessage,
      conversationHistory
    );

    console.log(`[PlaybookMatcher] Detected intents: ${intentAnalysis.detected_intents.join(", ")} (confidence: ${intentAnalysis.confidence})`);

    // Step 2: Get all active playbooks for the organization
    const playbooks = await this.playbookService.getPlaybooks(organizationId);
    const activePlaybooks = playbooks.filter(p => p.status === PlaybookStatus.ACTIVE);

    if (activePlaybooks.length === 0) {
      console.log(`[PlaybookMatcher] No active playbooks found`);
      return {
        playbook: null,
        intentAnalysis,
        switched: false
      };
    }

    // Step 3: Use AI to evaluate which playbooks match
    const playbookData = activePlaybooks.map(p => ({
      id: p.id,
      title: p.title,
      trigger: p.trigger,
      description: p.description || undefined
    }));

    const evaluation = await this.intentDetector.evaluatePlaybookMatches(
      userMessage,
      playbookData,
      conversationHistory
    );

    console.log(`[PlaybookMatcher] AI evaluated ${evaluation.matches.length} matching playbooks`);
    
    if (evaluation.matches.length > 0) {
      console.log(`[PlaybookMatcher] Top match: ${evaluation.matches[0].playbook_id} (confidence: ${evaluation.matches[0].confidence})`);
      console.log(`[PlaybookMatcher] Reasoning: ${evaluation.matches[0].reasoning}`);
    }

    // Step 4: Select the best matching playbook
    let selectedPlaybook: Playbook | null = null;
    let confidence: number | undefined;
    let reasoning: string | undefined;

    if (evaluation.matches.length > 0) {
      // Find the playbook object for the best match
      const bestMatch = evaluation.matches[0];
      const bestMatchId = bestMatch.playbook_id;
      selectedPlaybook = activePlaybooks.find(p => p.id === bestMatchId) || null;
      confidence = bestMatch.confidence;
      reasoning = bestMatch.reasoning;
      
      // Check if this is a high-priority trigger that should override current playbook
      if (selectedPlaybook && bestMatch.confidence > 0.8) {
        // High confidence match - consider switching
        console.log(`[PlaybookMatcher] High confidence match found`);
      } else if (currentPlaybookId && bestMatch.confidence < 0.6) {
        // Low confidence - maybe stick with current playbook
        const currentPlaybook = activePlaybooks.find(p => p.id === currentPlaybookId);
        if (currentPlaybook && !this.shouldAllowSwitch(currentPlaybook, selectedPlaybook)) {
          console.log(`[PlaybookMatcher] Confidence too low to switch from current playbook`);
          selectedPlaybook = currentPlaybook;
          reasoning = "Continuing with current playbook due to low confidence in alternative";
        }
      }
    } else {
      // No AI matches - try to find a fallback playbook
      console.log(`[PlaybookMatcher] No AI matches found, looking for fallback`);
      selectedPlaybook = activePlaybooks.find(
        p => p.trigger === "general_help" || p.trigger === "default_welcome"
      ) || null;
      reasoning = "No specific match found, using fallback playbook";
      confidence = 0.3;
    }

    const switched = currentPlaybookId !== selectedPlaybook?.id;

    if (switched && selectedPlaybook) {
      console.log(`[PlaybookMatcher] Switching from playbook ${currentPlaybookId} to ${selectedPlaybook.id} (${selectedPlaybook.title})`);
    } else if (selectedPlaybook) {
      console.log(`[PlaybookMatcher] Continuing with current playbook ${selectedPlaybook.id} (${selectedPlaybook.title})`);
    }

    return {
      playbook: selectedPlaybook,
      intentAnalysis,
      switched,
      confidence,
      reasoning
    };
  }



  /**
   * Checks if a playbook switch should be allowed mid-conversation.
   * Some playbooks should not be interrupted once started.
   * @param currentPlaybook - Currently active playbook
   * @param newPlaybook - Proposed new playbook
   * @returns True if switch is allowed
   */
  shouldAllowSwitch(
    currentPlaybook: Playbook | null,
    newPlaybook: Playbook | null
  ): boolean {
    // Always allow if no current playbook
    if (!currentPlaybook) return true;

    // Always allow switching to human escalation
    if (newPlaybook?.trigger === "human_escalation") return true;

    // Don't interrupt field collection playbooks
    if (currentPlaybook.required_fields && currentPlaybook.required_fields.length > 0) {
      console.log(`[PlaybookMatcher] Not switching - current playbook is collecting fields`);
      return false;
    }

    // Don't interrupt certain playbook kinds
    const nonInterruptibleKinds = ["intake", "onboarding"];
    if (currentPlaybook.kind && nonInterruptibleKinds.includes(currentPlaybook.kind)) {
      console.log(`[PlaybookMatcher] Not switching - current playbook kind '${currentPlaybook.kind}' is non-interruptible`);
      return false;
    }

    return true;
  }
}