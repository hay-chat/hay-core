# CONTEXT

**Current Task**: Handoff summary + footer takeover bar on conversation page — implemented, uncommitted on master.

**Key Decisions**:

- New `summary` text column on conversations (migration ran); LLM-generated (prompt conversation/handoff-summary) whenever status flips to pending-human (run.ts HANDOFF, message-recovery escalation, service hook).
- Footer bar in conversations/[id].vue for real pending-human convos: summary left, Take Over right (reuses existing handler); playground panel untouched.
- Header Take Over button kept; consolidating [id].vue inline takeover logic onto useConversationTakeover deferred.

**Next Steps**:

- Live-test a low-confidence handoff to see the summary populate in the footer.
- Commit + PR when asked (older uncommitted work also on master, see WIP.md).
