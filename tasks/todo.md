# Nuvemshop (Nuven Shop) Plugin — tasks/todo.md

## Goal + acceptance criteria

Build a Hay plugin for Nuvemshop/Tiendanube (LatAm e-commerce), modeled on the Shopify plugin:

- [x] Agent can look up/import product information (search/get products, SKU lookup, categories,
      plus `products`-capability catalog sync into core)
- [x] Agent can work orders and the refund workflow the Nuvemshop API actually supports
      (check refund status, cancel with guardrails — the public API cannot move money)
- [x] Plugin follows the build-plugin skill contract: `hay-plugin` block, no manifest.json,
      ESM, strict TS, `defineHayPlugin` default export
- [x] i18n en.json + pt.json + es.json with every tool + config field
- [x] Builds (`npm run build --workspace=plugins/core/nuvemshop`) pass
- [x] Adversarial review findings addressed (13 confirmed → fixed in adb5d10)
- [x] Committed + pushed to `claude/nuven-shop-integration-suwzch`, draft PR #71 updated

## Checklist

- [x] Load build-plugin skill; read contract/archetypes/anti-patterns/templates
- [x] Research (workflow wf_a2b0911a-c3b): shopify + klaviyo dissection; Nuvemshop API
- [x] Design: archetype A, custom-app token auth, 13 tools, honest refund workflow
- [x] Scaffold + implement plugin (src/, mcp/ with lib/ + tools/, i18n/, thumbnail.svg, README)
- [x] Verify: SDK build + plugin build pass; MCP stdio smoke test lists 13 tools with schemas;
      9 handler-level tests with mocked API pass (guardrails, i18n flattening, stock resolution);
      compiled entry loads with correct hooks; i18n keys match tool names in all 3 locales
- [x] Review workflow (wf_6760c0aa-39b) → 13 confirmed findings fixed: paginated
      order-by-number (status=any, exhaustion before not-found), money guard covers
      partially_refunded/authorized with truthful per-state messaging, GET-only replay on
      5xx/transport errors (429 retryable for all), total header null/empty → undefined,
      err.status on 401/402, bulkSync bounded retry honoring X-Rate-Limit-Reset, zod
      bounds/clamps on pagination, find_customer email/query normalization
- [x] Round-2 handler tests (12 scenarios) + round-1 (9) + stdio smoke re-pass
- [x] Commit (74805fc feat, adb5d10 fix), push, update PR #71

## Working notes

- Nuvemshop merchant API CANNOT move money: no refund endpoint for regular apps; Transactions
  refund events are payment-provider-apps only; POST /orders/{id}/cancel is bookkeeping only.
  Tools encode this honestly (check_refund_status guidance; cancel requires
  confirm_paid_cancellation=true on paid orders; never claims money moved).
- Auth: custom-app ("Aplicativo a medida") token + store ID; tokens never expire → no cron.
  Managed OAuth left as TODO (Tiendanube authorize URL is nonstandard: /apps/{app_id}/authorize,
  no scope param).
- API quirks: `Authentication: bearer <token>` header (lowercase, NOT Authorization);
  User-Agent mandatory; 402 = store subscription lapsed; 429 leaky bucket w/ X-Rate-Limit-Reset
  in ms; i18n fields are {es,pt,en} objects; v1 `stock` vs 2025-03 `inventory_levels`.
- scripts/build-plugins.sh now installs mcp/ deps — the skill's "dependency gap" anti-pattern
  is fixed; commit mcp/package-lock.json, node_modules stays gitignored.

## Results

**What changed:** new plugin `plugins/core/nuvemshop` — package.json (hay-plugin block:
integration, [mcp, auth, products]), src/index.ts (config/auth registration, validation via
GET /store, MCP startup, REST catalog bulkSync → CanonicalProduct), mcp/ CommonJS server
(13 tools: store 1, products 4, orders 6, customers 2), i18n en/pt/es, thumbnail.svg, README.

**How verified:** plugin-sdk + plugin `tsc` builds clean; stdio smoke test (initialize +
tools/list) returns all 13 tools with real zod schemas; mocked-API handler tests cover the
cancel guardrails (shipped refusal, paid confirmation, restock/email params), refund-status
degradation, exact order-number and email matching, i18n flattening, multi-inventory stock
summing; compiled entry default-exports a definition with the 5 lifecycle hooks.
