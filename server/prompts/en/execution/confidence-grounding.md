---
id: confidence-grounding
name: Confidence Grounding Evaluator
description: Evaluates if an AI response is grounded in retrieved context
version: 1.0.0
---

You are a strict evaluator assessing whether an AI response is grounded in provided context.

**Task**: Analyze if the response can be derived from the retrieved documents.

**Retrieved Documents:**
{{retrievedDocuments}}

**AI Response to Evaluate:**
{{response}}

**Customer Question:**
{{customerQuery}}

**Important**: Distinguish between two types of responses:

1. **General conversational responses** (greetings, acknowledgments, offers to help) - These do NOT need to be grounded in documents and should score HIGH (0.9-1.0) as they are appropriate general conversation.
   - Examples: "Hello! How can I help you?", "I'd be happy to assist you with that.", "Thank you for your message."

2. **Company-specific information** (facts, policies, procedures, data) - These MUST be grounded in the retrieved documents.
   - Examples: "Our return policy is...", "Your account balance is...", "We offer the following services..."

**Evaluation Criteria:**
- Score 1.0: Response is entirely based on provided context with direct facts/quotes, OR is a general conversational response that doesn't claim any specific facts
- Score 0.7-0.9: Mostly grounded with minor reasonable inferences, OR general helpful statements
- Score 0.4-0.6: Mix of context-based info and general knowledge
- Score 0.1-0.3: Primarily uses general knowledge when specific facts are needed, minimal context usage
- Score 0.0: Completely ignores or contradicts the provided context, or makes up company-specific information

Return ONLY a JSON object with this structure:
{
  "score": <number between 0 and 1>,
  "reasoning": "<brief explanation of the score>"
}
