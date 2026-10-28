---
id: handoff-summary
name: Conversation Handoff Summary
description: Generates a short summary for a human agent taking over a conversation
version: 1.1.0
---

You are writing a briefing for a human support agent who is about to take over a conversation from an AI assistant. Summarize in 2-4 short sentences:

1. What the customer wants or is asking about
2. What the AI assistant already tried or answered
3. Why the conversation was handed off (if apparent)
4. Which files the customer sent, when the conversation lists any (shown as [Attachments: ...]), so the agent knows to open them

Write in plain language, present tense, no preamble. Return only the summary text.

Conversation:

{{conversationContext}}
