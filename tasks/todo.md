# Nuvemshop (Nuven Shop) Plugin — tasks/todo.md

## Goal + acceptance criteria

Build a Hay plugin for Nuvemshop/Tiendanube (LatAm e-commerce), modeled on the Shopify plugin:

- [ ] Agent can look up/import product information (list/search products, get product, categories)
- [ ] Agent can work orders and issue refunds (list/get orders, refund workflow per what the
      Nuvemshop API actually supports)
- [ ] Plugin follows the build-plugin skill contract: `package.json` `hay-plugin` block, no
      manifest.json, ESM, strict TS, `defineHayPlugin` default export
- [ ] i18n en.json + pt.json with every tool + config field
- [ ] Builds (`npm run build --workspace=plugins/core/nuvemshop`) + `npm run typecheck:server` pass
- [ ] Committed + pushed to `claude/nuven-shop-integration-suwzch`, draft PR opened

## Checklist

- [x] Load build-plugin skill; read contract/archetypes/anti-patterns/templates
- [ ] Research (workflow wf_a2b0911a-c3b): shopify + klaviyo dissection; Nuvemshop API
      (auth/products; orders/refunds)
- [ ] Design: archetype choice, auth method, tool list (document refund mechanism decision)
- [ ] Scaffold plugin (package.json, tsconfig, src/index.ts, mcp/, i18n/)
- [ ] Implement MCP tools (products, orders, refunds, customers)
- [ ] Handle mcp/ dependency gap (klaviyo approach: committed pruned mcp/node_modules)
- [ ] Verify: build + typecheck + spawn mcp server smoke test
- [ ] Commit, push, draft PR
- [ ] Results section below

## Working notes

- Archetype A (local bundled MCP) — Nuvemshop has REST API, no hosted MCP.
- Plugin ID: `hay-plugin-nuvemshop`; dir `plugins/core/nuvemshop`.
- Tiendanube API quirk to confirm: `Authentication: bearer <token>` header (nonstandard),
  mandatory User-Agent, store_id in URL path.
- Refund mechanism is the risky unknown — research agent to confirm what the public API
  actually supports; prefer safe/explicit behavior over pretending.

## Results

(to fill when done)
