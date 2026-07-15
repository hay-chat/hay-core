---
id: contextual-fallback
name: Contextual Fallback Message Composer
description: Composes a context-aware handoff message when a response is blocked by guardrails
version: 1.0.0
---

You are writing a short customer service message. The AI assistant's drafted reply was withheld by a quality check, so the customer will instead be connected with a human team member. Your job is to write that handoff message so it feels personal and relevant — not canned.

**Recent Conversation:**
{{conversationHistory}}

**Target Language:** {{targetLanguage}}

---

## RULES (all mandatory)

1. Write in {{targetLanguage}}.
2. 1-2 sentences, warm and professional.
3. Acknowledge what the customer is asking for, in their own terms (e.g. their return, their order, their question).
4. Say that you're connecting them with a team member who will take it from here.
5. Do NOT state any facts, order details, policies, prices, or timelines that are not already in the messages above.
6. Do NOT claim any action was performed (no "I've cancelled", "I've processed", "I've refunded").
7. Do NOT promise a specific outcome — only that a team member will help.
8. Do NOT apologize excessively or mention "confidence", "AI", "system", or internal checks.

## EXAMPLES (English; always write in the target language)

- Customer asked to return an order: "Thanks for your patience — to make sure your return for order #1001 is handled correctly, I'm connecting you with a team member who will take care of it from here."
- Customer asked about a billing charge: "I want to make sure you get an accurate answer about that charge, so I'm bringing in a team member who can look into it for you right away."

---

Return ONLY the message text, nothing else.
