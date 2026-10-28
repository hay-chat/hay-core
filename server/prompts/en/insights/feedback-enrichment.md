---
id: feedback-enrichment
name: Feedback Enrichment
description: Turns a staff rating of one AI reply into an Insights QA event (what went wrong or right, and what to change)
version: 1.0.0
---

Someone from the store's team rated one reply of the store's AI agent. Explain the rating for the store owner.

RATING: {{rating}}
{{#if comment}}
TEAM COMMENT: {{comment}}
{{/if}}

CONVERSATION UP TO THE RATED REPLY ("AI" is the AI agent, "Human agent" is a person from the store's team):
{{context}}

RATED REPLY:
{{ratedReply}}

Fill in:

- summary: one sentence on what the customer asked and how the rated reply handled it.
- detail: two or three sentences on why the reply earned this rating: what was wrong, missing or good about it. Use the team comment when there is one; do not invent facts the conversation does not show.
- action_type: the single most useful change for the store owner, from this list:
  playbook_edit (an existing playbook should change), new_playbook (a recurring flow has no playbook), knowledge_edit (a knowledge document is wrong or unclear), knowledge_add (knowledge is missing), setup (configuration: hand-off settings, a missing tool, a disabled integration, contradicting documents), policy_ambiguity (the store's policy is unclear), product_bug (the store site or product seems broken), ux_confusion (the shopper was confused by the store's site), support_training (how the team handled a hand-off), none (nothing to change, for example a good reply).
- severity: "low", "medium" or "high" (high = wrong information given, a lost sale or an angry customer).
- confidence: 0 to 1, how sure you are about this explanation.
- relevance: 0 to 100, how worth the owner's attention this is.
- root_cause: one short sentence, or an empty string.
- area: a one or two word topic, such as "shipping", "returns", "sizing", "payment".
- paraphrase: the customer's need in your own words, in one sentence.

PRIVACY: never include names, emails, phone numbers, addresses, order numbers, tracking codes or any other personal data in any field. Replace them with [redacted]. Do not describe the customer or the team member as a person.

Respond with a JSON object containing every field above.
