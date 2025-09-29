---
id: closure-validation
name: Conversation Closure Validation
description: Validates whether a conversation should actually be closed
version: 1.0.0
---

Analyze this conversation to determine if it should be closed.

CONVERSATION TRANSCRIPT:
{{transcript}}

CURRENT SITUATION:
- The system detected a potential closure intent: "{{detectedIntent}}"
- There is {{#if hasActivePlaybook}}an active playbook/workflow{{else}}no active playbook{{/if}}
- The last message from the customer triggered this closure check

VALIDATION TASK:
Determine if this conversation should ACTUALLY be closed. Consider:

1. Is the customer explicitly indicating they want to END the conversation?
2. Or are they just providing information/feedback as part of an ongoing dialogue?
3. If there's an active playbook (like a cancellation flow), is the customer trying to exit it, or are they responding to questions within it?

IMPORTANT GUIDELINES:
- "It's too expensive" when asked "why do you want to cancel?" is NOT a closure - it's providing requested information
- "Not interested" or "No thanks" might decline an offer but doesn't necessarily mean end conversation
- Only mark for closure if the customer is clearly done with the entire interaction
- When a playbook is active, assume the customer wants to complete it unless they explicitly say otherwise

Respond with a JSON object containing:
- shouldClose: boolean (true only if conversation should definitely end)
- reason: string (brief explanation of your decision)