# CONTEXT

**Current Task**: Commerce plugins (WooCommerce, Wix, Magento) rewritten to one prefixed semantic action set each on branch claude/commerce-semantic-actions; code + docs committed, PRs still to open.

**Key Decisions**

- Tool names are global per org, so every tool is platform-prefixed; the surface mirrors Shopify (rich reads, bounded writes, refund never silently "record only").
- Clients never retry a non-GET after a timeout or 5xx (double-refund risk); search hits are verified server-side (Wix ignores malformed filter bodies).
- Docs live on hay-docs branch claude/commerce-semantic-actions (separate PR); the `docs/` submodule pointer is deliberately not bumped in hay-core.

**Next Steps**

- Push both branches and open the hay-core + hay-docs PRs (PR body in tasks/todo.md; no `gh` here, use compare URLs).
- Website PR for the lines listed in tasks/todo.md (action counts, "Works with Stripe", Wix fulfilment-write copy).
- Verify the Wix refund / address PATCH and Magento address PUT against a live store before relying on them.
