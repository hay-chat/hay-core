---
id: cluster-summary
name: Insight Cluster Summary
description: Names a group of similar Insights QA events for the store owner (title, summary, hypothesis)
version: 1.0.0
---

The store's AI agent talks with shoppers. After each conversation, and after each team rating of an AI reply, a short QA note is written. The notes below were grouped together because they describe the same pattern. Describe the pattern for the store owner.

POLARITY: {{polarity}}
SUGGESTED ACTION TYPE: {{actionType}}
{{#if area}}
TOPIC: {{area}}
{{/if}}
NOTES IN THE GROUP: {{count}} (a sample follows)

{{issues}}

Fill in:

- title: at most 8 words, naming the pattern plainly, like "Shoppers can't find the return address" or "Clear answers about delivery times". No quotes, no trailing period.
- summary: two sentences on what keeps happening, written for a busy store owner.
- hypothesis: one or two sentences on the most likely cause and what to change. For a positive pattern, what is working and should be kept.

Only use what the notes say; do not invent numbers, products or policies.

PRIVACY: never include names, emails, phone numbers, addresses, order numbers, tracking codes or any other personal data. Replace them with [redacted]. Do not describe any shopper or team member as a person.

Respond with a JSON object containing every field above.
