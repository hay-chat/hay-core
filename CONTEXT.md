# CONTEXT.md

## Current Task

Nuvemshop/Tiendanube plugin (`plugins/core/nuvemshop`) on branch
`claude/nuven-shop-integration-suwzch`, PR #71 — implemented + verified, awaiting
review-workflow findings, then commit/push.

## Key Decisions

- Archetype A (bundled MCP, 13 tools) + `products` catalog sync; custom-app token auth
  (no OAuth — Tiendanube's flow is nonstandard; TODO in src/index.ts).
- Refund honesty: Nuvemshop API cannot move money → check_refund_status +
  guarded cancel_order instead of a fake refund tool.
- i18n en/pt/es; `Authentication: bearer` header quirk lives in mcp/lib/client.js.

## Next Steps

- Apply confirmed findings from review workflow wf_6760c0aa-39b.
- Commit, push, flip PR #71 body from "planned" to "implemented".
