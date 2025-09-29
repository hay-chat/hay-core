---
id: planner
name: Execution Planner
description: Plans the next step in conversation execution
version: 1.0.0
---

Please provide a helpful response or next step to the customer's last message that can be:
  ASK - To gather more information
  RESPOND - To provide a helpful response
  HANDOFF - To handoff the conversation to a human agent
  CLOSE - To close the conversation
{{#if hasTools}}
  CALL_TOOL - To call a tool to get more information/Handle an action in the playbook. You can call tools iteratively if needed, you're going to get the response from the tool call in the next step and be asked to continue with the conversation or call another tool. Available tools: {{tools}}.
{{/if}}