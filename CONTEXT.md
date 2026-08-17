# CONTEXT.md

## Current Task

Nuvemshop/Tiendanube plugin (`plugins/core/nuvemshop`) — DONE. Implemented, adversarially
reviewed (13 findings fixed), verified, pushed to `claude/nuven-shop-integration-suwzch`,
draft PR #71 open.

## Key Decisions

- Archetype A (bundled MCP, 13 tools) + `products` catalog sync; custom-app token auth
  (no OAuth — Tiendanube's flow is nonstandard; TODO in src/index.ts).
- Refund honesty: Nuvemshop API cannot move money → check_refund_status + guarded
  cancel_order (paid/partially_refunded/authorized need confirm_paid_cancellation).
- Client replay policy: GET-only on 5xx/transport errors, 429 retryable for all methods.

## Next Steps

- Mark PR #71 ready for review when a human approves the tool surface.
- Future: managed OAuth partner-app mode; live-store validation of 2025-03 endpoints.
