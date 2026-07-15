# CONTEXT

**Current Task**: Shopify plugin MCP tool rework (support-flow shaped: rich reads, narrow writes) — implemented, uncommitted on master.

**Key Decisions**:

- Cut search_orders/create_customer_address/get_order_status; one find_customer + enriched get_customer/get_order (supportSummary).
- New: update_order_shipping_address (pre-dispatch only), calculate_refund, returns tools; create_refund bounded vs netPaymentSet server-side.
- Scopes +read/write_returns — previously connected stores must reconnect. Discount tools + order editing deliberately deferred (tasks/todo.md).

**Next Steps**:

- Commit + PR (also still pending: action-claim guardrail work, see WIP.md).
- Dev-store verification of orderCancel/refund-on-cancel and new mutations (TODO HAY-219 §8 markers).
- Keep get_shop until SDK supports session-start context injection.
