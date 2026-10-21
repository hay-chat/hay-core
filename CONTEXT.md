# CONTEXT

**Current Task**: WhatsApp Cloud API Phase 2 plugin (plugins/core/whatsapp) built on branch claude/whatsapp-plugin; PR open.

**Key Decisions**
- Manual mode = config fields; per-org URL (worker verifies) or shared URL (worker claims routing keys via webhooks.setRoutingKeys).
- STT lives in core (`media.upload({transcribe})`) because workers never see OPENAI_*; plugin UI talks to its worker only via authenticated `plugins.callUiRoute` (/ui/*).
- Public proxy now blocks worker-internal paths (PR #100) — ship before anything else.

**Next Steps**
- Merge #100, then the Phase 2 PR + hay-docs claude/whatsapp-plugin; deploy.
- Meta console: callback URL + verify token, subscribe webhook fields; E2E on test number.
- App Review videos (Phase A).
