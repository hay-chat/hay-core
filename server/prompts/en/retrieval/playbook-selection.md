---
id: playbook-selection
name: Playbook Selection
description: Selects the most relevant playbook for a conversation
version: 1.0.0
---

Given the conversation context below, score how relevant each playbook is (0-1 scale).
Consider the trigger phrases, descriptions, and overall context match.

Conversation context: "{{conversationContext}}"

Available playbooks:
{{#each playbooks}}
- ID: {{item.id}}, Title: "{{item.title}}", Trigger: "{{item.trigger}}", Description: "{{item.description|default:"No description"}}"
{{/each}}

For each playbook, provide a relevance score and brief rationale.