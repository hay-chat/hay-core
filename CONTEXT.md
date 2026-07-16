# CONTEXT

**Current Task**: Fixed empty tool schemas in playbook prompts, core-side idempotency_key injection, and playbook action validation — implemented, uncommitted on master.

**Key Decisions**:

- getCachedToolDescriptors now reads MCP-wire `inputSchema` (with `input_schema` legacy fallback) — root cause of `Input Schema: {}` in playbook messages and the failed refund conversation.
- Core injects its per-execution UUID as `idempotency_key` only when the tool's cached schema declares that property (schema-gated; overrides LLM-invented keys).
- playbooks create/update/publish return additive `actionWarnings`; new validateActions query for future dashboard linting.

**Next Steps**:

- Surface actionWarnings in the playbook editor UI.
- Retest the Karine Ruby refund conversation end-to-end (needs `shopify_calculate_refund` referenced in the playbook).
- Commit + PR when asked (older uncommitted work also on master, see WIP.md).
