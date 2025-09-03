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
        return this.fallbackDetection(userMessage);
      }
    } catch (error) {
      console.error("[IntentDetector] Error detecting intents:", error);
      // Use rule-based fallback if AI fails
      return this.fallbackDetection(userMessage);
    }
  }

  /**
   * Rule-based fallback intent detection.
   * Uses pattern matching when AI analysis fails.
   * @param userMessage - The user's message to analyze
   * @returns Basic intent analysis
   */
  private fallbackDetection(userMessage: string): IntentAnalysis {
    const lowerMessage = userMessage.toLowerCase();
    const detectedIntents: string[] = [];
    let confidence = 0.7; // Default confidence for rule-based detection

    // Check for human request patterns
    if (this.detectsHumanRequest(lowerMessage)) {
      detectedIntents.push("request_human");
      confidence = 0.9;
    }

    // Check for questions
    if (/\?|how |what |when |where |why |who |which |can |could |would |should /i.test(userMessage)) {
      detectedIntents.push("question");
    }

    // Check for greetings
    if (/^(hi|hello|hey|good morning|good afternoon|good evening|greetings)/i.test(lowerMessage)) {
      detectedIntents.push("greeting");
    }

    // Check for farewells
    if (/(bye|goodbye|thanks|thank you|that's all|nothing else|see you|farewell)/i.test(lowerMessage)) {
      detectedIntents.push("farewell");
    }

    // Check for complaints
    if (/(not working|broken|issue|problem|error|failed|can't|won't|unable|frustrated|angry|disappointed)/i.test(lowerMessage)) {
      detectedIntents.push("complaint");
    }

    // Check for billing
    if (/(bill|invoice|payment|charge|refund|subscription|price|cost|fee)/i.test(lowerMessage)) {
      detectedIntents.push("billing");
    }

    // Check for technical support
    if (/(install|setup|configure|debug|fix|troubleshoot|technical|api|integration)/i.test(lowerMessage)) {
      detectedIntents.push("technical_support");
    }

    // Default to general help if no specific intent detected
    if (detectedIntents.length === 0) {
      detectedIntents.push("general_help");
      confidence = 0.5;
    }

    return {
      detected_intents: detectedIntents,
      confidence,
      last_analyzed: new Date().toISOString(),
      raw_analysis: "Fallback rule-based detection"
    };
  }

  /**
   * Detects if the user is requesting human assistance.
   * @param message - Lowercase message to check
   * @returns True if human assistance is requested
   */
  private detectsHumanRequest(message: string): boolean {
    const humanRequestPatterns = [
      /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)/,
      /\b(want|need|like|prefer)\s+(a\s+)?(human|person|agent|representative)/,
      /transfer\s+me/,
      /real\s+person/,
      /live\s+(support|agent|chat)/,
      /customer\s+(service|support)/,
      /operator/,
      /escalate/
    ];
    
    return humanRequestPatterns.some(pattern => pattern.test(message));
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
      const systemPrompt = `You are a playbook matching system. Given a user's message and a list of available playbooks, determine which playbooks are relevant.

Available playbooks:
${playbooks.map(p => `- ID: ${p.id}
  Title: ${p.title}
  Trigger: ${p.trigger}
  Description: ${p.description || 'N/A'}`).join('\n')}

Analyze the user's message and determine:
1. Which playbook(s) best match the user's intent
2. Your confidence level (0-1) for each match
3. Brief reasoning for each match

Consider:
- The user's explicit request
- Implicit needs based on context
- Urgency or priority indicators
- Emotional tone

Respond with a JSON object:
{
  "matches": [
    {
      "playbook_id": "uuid-here",
      "confidence": 0.95,
      "reasoning": "User explicitly asked for..."
    }
  ]
}

Only include playbooks with confidence > 0.3.
Order by confidence (highest first).
If no playbooks match well, return an empty matches array.`;

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