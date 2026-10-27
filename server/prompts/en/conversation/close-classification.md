---
id: close-classification
name: Conversation Close Classification
description: At close, decides whether the AI resolved the conversation (billing) and writes a QA review (Insights)
version: 1.0.0
---

You review a customer support conversation that has just ended. "AI" is the store's AI agent, "Human agent" is a person from the store's team.

CONVERSATION:
{{transcript}}

FACTS:

- How it ended: {{closeReason}}
- Handed off to a human at some point: {{handedOff}}
- Channel: {{channel}}

PART 1: OUTCOME. Answer from the transcript only.

- is_spam: true only for bot traffic, advertising, gibberish, abuse or test messages with no real customer behind them.
- had_real_request: true when the customer asked for something real (a question, a problem, a request). Greetings alone, "thanks" alone or an empty chat are false.
- ai_resolved: true when the AI's own replies answered the request or completed what was asked, so the customer had what they needed. A human may have been involved, but only count it when the AI did the resolving work. False when the AI only greeted, asked questions back, said it could not help, gave a wrong or empty answer, or when a human agent did the resolving work. When the customer simply stopped replying, decide whether the AI's last substantive reply plausibly gave them what they needed.
- outcome_reason: one short sentence explaining the decision.

PART 2: QA REVIEW for the store owner.

- summary: one or two sentences on what the customer wanted and how it went.
- polarity: "positive" (went well), "negative" (something went wrong or could be better) or "neutral".
- action_type: the single most useful change for the store owner, from this list:
  playbook_edit (an existing playbook should change), new_playbook (a recurring flow has no playbook), knowledge_edit (a knowledge document is wrong or unclear), knowledge_add (knowledge is missing), setup (configuration: hand-off settings, a missing tool, a disabled integration, contradicting documents), policy_ambiguity (the store's policy is unclear), product_bug (the store site or product seems broken), ux_confusion (the shopper was confused by the store's site), support_training (how the team handled a hand-off), none (nothing to change).
- severity: "low", "medium" or "high" (high = lost sale, wrong information given, or an angry customer).
- confidence: 0 to 1, how sure you are about this review.
- relevance: 0 to 100, how worth the owner's attention this is. Generic small talk or sentiment alone is low.
- root_cause: one short sentence, or an empty string.
- area: a one or two word topic, such as "shipping", "returns", "sizing", "payment".
- snippet: a short verbatim excerpt (at most 300 characters) from the conversation that best shows the issue.
- paraphrase: the customer's need in your own words, in one sentence.

PRIVACY: never include names, emails, phone numbers, addresses, order numbers, tracking codes or any other personal data in any field. Replace them with [redacted]. Do not describe the customer as a person.

Respond with a JSON object containing every field above.
