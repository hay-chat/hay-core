---
id: agent-selection
name: Agent Selection
description: Selects the most relevant agent for a user message
version: 1.0.0
---

Given the user message below, score how relevant each agent is (0-1 scale).
Consider the trigger phrases, descriptions, and overall context match.

User message: "{{message}}"

Available agents:
{{#each agents}}
- ID: {{id}}, Name: "{{name}}", Trigger: "{{trigger}}", Description: "{{description|default:"No description"}}"
{{/each}}

For each agent, provide a relevance score and brief rationale.