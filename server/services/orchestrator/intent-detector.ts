import { Hay } from "../hay.service";
import type { IntentAnalysis } from "./types";

/**
 * Detects user intents from messages using AI analysis.
 * Provides confidence scores and intent classification.
 */
export class IntentDetector {
  /**
   * Analyzes a user message to detect intents.
   * Uses AI to classify the message into one or more intent categories.
   * @param userMessage - The user's message to analyze
   * @param conversationHistory - Optional conversation context
   * @returns Intent analysis with detected intents and confidence
   */
  async detectIntents(
    userMessage: string,
    conversationHistory?: string
  ): Promise<IntentAnalysis> {
    try {
      // Initialize Hay service
      Hay.init();

      // Build the prompt for intent detection
      const systemPrompt = `You are an intent detection system. Analyze the user's message and identify their primary intents.

Common intents include:
- question: User is asking for information
- complaint: User is expressing dissatisfaction
- request_human: User wants to speak with a human
- greeting: User is greeting or starting conversation
- farewell: User is saying goodbye or ending conversation
- technical_support: User needs technical help
- billing: User has billing or payment questions
- product_inquiry: User is asking about products/services
- feedback: User is providing feedback
- confirmation: User is confirming or acknowledging
- clarification: User needs clarification
- status_check: User is checking on status/progress
- general_help: User needs general assistance

Respond with a JSON object containing:
{
  "intents": ["primary_intent", "secondary_intent"],
  "confidence": 0.95,
  "explanation": "Brief explanation of why these intents were detected"
}

Only include intents you're confident about. Confidence should be between 0 and 1.`;

      const userPrompt = conversationHistory 
        ? `Conversation context:\n${conversationHistory}\n\nLatest message: ${userMessage}`
        : `User message: ${userMessage}`;

      // Get AI analysis
      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        userPrompt
      );

      // Parse the AI response
      try {
        const analysis = JSON.parse(response.content);
        
        return {
          detected_intents: analysis.intents || [],
          confidence: analysis.confidence || 0.5,
          last_analyzed: new Date().toISOString(),
          raw_analysis: analysis.explanation
        };
      } catch (parseError) {
        // Fallback if AI doesn't return valid JSON
        console.warn("[IntentDetector] Failed to parse AI response, using fallback detection");
        return await this.fallbackDetection(userMessage);
      }
    } catch (error) {
      console.error("[IntentDetector] Error detecting intents:", error);
      // Use LLM-based fallback if AI fails
      return await this.fallbackDetection(userMessage);
    }
  }

  /**
   * LLM-based fallback intent detection.
   * Uses a simpler LLM call when the main detection fails.
   * @param userMessage - The user's message to analyze
   * @returns Basic intent analysis
   */
  private async fallbackDetection(userMessage: string): Promise<IntentAnalysis> {
    try {
      // Initialize Hay service
      Hay.init();

      // Simpler prompt for fallback
      const systemPrompt = `You are a simple intent detector. Analyze the user's message and identify their intent.

Common intents: question, greeting, farewell, complaint, billing, technical_support, request_human, general_help

Respond with JSON: {"intent": "primary_intent", "confidence": 0.8}`;

      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        `User message: ${userMessage}`
      );

      const analysis = JSON.parse(response.content);
      
      return {
        detected_intents: [analysis.intent || "general_help"],
        confidence: analysis.confidence || 0.5,
        last_analyzed: new Date().toISOString(),
        raw_analysis: "LLM fallback detection"
      };
    } catch (error) {
      console.error("[IntentDetector] Fallback detection failed:", error);
      // Ultimate fallback
      return {
        detected_intents: ["general_help"],
        confidence: 0.3,
        last_analyzed: new Date().toISOString(),
        raw_analysis: "Ultimate fallback - general help"
      };
    }
  }


  /**
   * Evaluates which playbooks match the user's message using AI.
   * Provides all available playbooks to the LLM for intelligent matching.
   * @param userMessage - The user's message
   * @param playbooks - Available playbooks with triggers and descriptions
   * @param conversationHistory - Optional conversation context
   * @returns Evaluation of which playbooks match and their confidence scores
   */
  async evaluatePlaybookMatches(
    userMessage: string,
    playbooks: Array<{ id: string; title: string; trigger: string; description?: string }>,
    conversationHistory?: string
  ): Promise<{
    matches: Array<{
      playbook_id: string;
      confidence: number;
      reasoning: string;
    }>;
  }> {
    try {
      // Initialize Hay service
      Hay.init();

      // Build the prompt for playbook matching
      const systemPrompt = `You are a conservative playbook matching system. Given a user's message and a list of available playbooks, determine which playbooks are CLEARLY and SPECIFICALLY relevant.

Available playbooks:
${playbooks.map(p => `- ID: ${p.id}
  Title: ${p.title}
  Trigger: ${p.trigger}
  Description: ${p.description || 'N/A'}`).join('\n')}

IMPORTANT GUIDELINES:
- Only match playbooks when there is CLEAR, SPECIFIC relevance to the user's intent
- For generic greetings (hello, hi, good morning), return NO matches - let the AI handle these naturally
- For simple questions without specific business context, return NO matches
- Only match if the user's message directly relates to the playbook's trigger/purpose
- Be conservative - when in doubt, return no matches

Analyze the user's message and determine:
1. Which playbook(s) CLEARLY match the user's SPECIFIC intent (not general conversation)
2. Your confidence level (0-1) for each match
3. Brief reasoning for each match

Consider:
- The user's explicit request must closely match the playbook's purpose
- There must be clear business context or specific need
- Generic conversation should NOT trigger playbooks

Respond with a JSON object:
{
  "matches": [
    {
      "playbook_id": "uuid-here",
      "confidence": 0.85,
      "reasoning": "User explicitly mentioned specific issue matching this playbook..."
    }
  ]
}

STRICT CRITERIA:
- Only include playbooks with confidence > 0.7 (high confidence only)
- Order by confidence (highest first)
- If the message is generic conversation, greeting, or unclear intent, return an empty matches array
- Better to return NO match than a wrong match`;

      const userPrompt = conversationHistory 
        ? `Conversation context:\n${conversationHistory}\n\nLatest message: ${userMessage}`
        : `User message: ${userMessage}`;

      // Get AI analysis
      const response = await Hay.invokeWithSystemPrompt(
        systemPrompt,
        userPrompt
      );

      // Parse the AI response
      try {
        const result = JSON.parse(response.content);
        return {
          matches: result.matches || []
        };
      } catch (parseError) {
        console.warn("[IntentDetector] Failed to parse playbook matching response");
        return { matches: [] };
      }
    } catch (error) {
      console.error("[IntentDetector] Error evaluating playbook matches:", error);
      return { matches: [] };
    }
  }

  /**
   * Checks if detected intents match a playbook's trigger conditions.
   * @param intents - Array of detected intents
   * @param trigger - Playbook trigger to match against
   * @returns True if intents match the trigger
   */
  matchesPlaybookTrigger(intents: string[], trigger: string): boolean {
    // Direct intent match
    if (intents.includes(trigger)) {
      return true;
    }

    // Map common triggers to intents
    const triggerMappings: Record<string, string[]> = {
      "human_escalation": ["request_human"],
      "welcome": ["greeting"],
      "ender": ["farewell", "confirmation"],
      "billing_inquiry": ["billing"],
      "technical_support": ["technical_support", "complaint"],
      "product_inquiry": ["product_inquiry", "question"],
      "general_help": ["general_help", "question"]
    };

    const mappedIntents = triggerMappings[trigger] || [];
    return mappedIntents.some(intent => intents.includes(intent));
  }
}