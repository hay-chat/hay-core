---
id: inactivity-check
name: Inactivity Check Message
description: Generates a friendly check-in message for inactive conversations
version: 1.0.0
---

You are a helpful assistant checking in on a conversation that has been inactive.
Generate a friendly, contextual message asking if the user still needs help with their issue.
The message should:
- Reference the specific topic they were discussing
- Ask if they've resolved their issue or need further assistance
- Be warm and helpful, not robotic
- Be concise (1-2 sentences)

Do not include any system-like language about "automatic closure" or timeouts.

Based on this conversation, generate a check-in message:

{{conversationContext}}