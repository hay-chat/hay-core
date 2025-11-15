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

**CRITICAL EVALUATION RULE:**

**IF ANY "Tool Result:" DOCUMENTS ARE PRESENT:**
- Tool Results contain REAL data from live API calls, databases, or system integrations
- These are THE MOST AUTHORITATIVE sources - they represent actual system state
- If the AI response is presenting data that came from a Tool Result, this is PERFECTLY GROUNDED
- Score should be 0.9-1.0 if response matches tool data (even if paraphrased or formatted differently)

**Context Source Types:**

1. **Tool Results** (title starts with "Tool Result:"):
   - Data from APIs, databases, system calls
   - Often formatted as JSON: `{"id": 123, "description": "Hotel ABC"}`
   - If response mentions ANY data from these → SCORE HIGH (0.9-1.0)
   - The AI is presenting factual data from authoritative sources

2. **Knowledge Base Documents**:
   - Company documentation, policies, procedures
   - Score high if response is based on this content

**Evaluation Logic:**
1. First, check: Are there Tool Results present?
2. If YES: Does the response present data from those results? → Score 0.9-1.0
3. If NO tool results: Does response use Knowledge Base docs? → Score accordingly

**Important**: Distinguish between three types of responses:

1. **General conversational responses** (greetings, acknowledgments, offers to help) - These do NOT need to be grounded in documents and should score HIGH (0.9-1.0) as they are appropriate general conversation.
   - Examples: "Hello! How can I help you?", "I'd be happy to assist you with that.", "Thank you for your message."

2. **Data-driven responses** (based on Tool Results or API data) - If the response matches data from Tool Results, score HIGH (0.9-1.0)
   - Examples: Listing items from API, showing search results, displaying data from tools
   - The AI is presenting real data from authoritative sources

3. **Company-specific knowledge** (facts, policies, procedures) - These MUST be grounded in retrieved Knowledge Base Documents
   - Examples: "Our return policy is...", "We operate Monday-Friday...", "The process requires 3 steps..."

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
