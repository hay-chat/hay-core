---
id: intent-analysis
name: Intent Analysis
description: Analyzes user message intent and sentiment
version: 1.0.0
---

Analyze the following user message and determine:
1. The intent (what the user wants to accomplish)
2. The sentiment (emotional tone of the message)
3. The language (language in which the message was written - ISO 639-1 two-letter code, e.g., "pt", "en", "es", "de", "fr")

## IMPORTANT RULES FOR INTENT CLASSIFICATION:
- Only use "close_satisfied" or "close_unsatisfied" when the user EXPLICITLY indicates they want to END the conversation
- Examples of CLOSURE language: "goodbye", "bye", "that's all", "I'm done", "no more questions", "close this", "end conversation"
- Examples that are NOT closure (classify as "request" or "other"):
  * "it's too expensive" - This is providing a reason/complaint, not asking to close
  * "I don't like it" - This is feedback, not a closure request
  * "not interested" - This could be declining an offer, not necessarily ending conversation
  * "cancel my subscription" - This is a service request, not conversation closure
- When the user is responding to a question (like "why do you want to cancel?"), their answer should be classified based on the content, NOT as closure
- When in doubt, prefer "request", "question", or "other" over closure intents
- Closure intents should have confidence > 0.8 to be valid

SPECIAL NOTE: Gratitude messages like "thank you", "thanks", "appreciate it" should typically be classified as "greet" rather than closure. However, be aware that these MAY indicate conversation closure when they come after task completion. The system will evaluate context separately to determine if closure is appropriate.

User message: "{{message}}"