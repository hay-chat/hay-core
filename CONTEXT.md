# CONTEXT.md

**Current Task**: WhatsApp Cloud API Phase 1 (core enablers) complete on `claude/whatsapp-cloud`; PR open. Phase 2 (plugin `plugins/core/whatsapp`, npm `hay-channel-whatsapp-meta`) is next.

**Key Decisions**
- Raw webhook bytes are forwarded as the worker request body (`req.rawBody` in the SDK runner); the base64 header is gone.
- Config fields can be `serverOnly` so OAuth client secrets never reach workers; Embedded Signup code exchange runs in core via `plugins.oauth.completeWithCode`.
- Provider statuses live in `messages.provider_status/provider_error`, never in `delivery_state` (test-mode gate).

**Next Steps**
- Merge PR; run migration 1784400000000 in prod.
- Phase 2 needs `META_WHATSAPP_ES_CONFIG_ID` (Roger, Phase 0) and Advanced Access for the two whatsapp_business_* permissions (Phase A).
- Build the plugin per PLAN.md §3 Phase 2 (graph-client, webhook normaliser, deliver, ES popup UI, manual-token mode).
