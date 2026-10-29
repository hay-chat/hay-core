# Knowledge base

The documents the Casa Aurora AI agent retrieves from. Policy facts come from
`company/brand.md` (the single source of truth) and product facts from `catalog/products.json`.
If those change, change these files to match.

```
knowledge/
  en/      US store (Shopify) and Europe store (WooCommerce)
  pt-BR/   Brasil store (Nuvemshop)
```

One topic per file, short and factual. Each file starts with front-matter:

```yaml
---
title: Shipping (Casa Aurora US) # the document title in Hay.chat, also the idempotency key
type: policy # article | guide | faq | tutorial | reference | policy
platforms: [shopify] # optional: only these stores; default = every store of this locale
---
```

Store-specific facts (shipping, payments, hours) live in their own file with the store in the
title and `platforms:` set, so the US org never sees Europe prices. Shared files (returns,
damage, care, products) apply to every store of their locale.

## How it's loaded

`scripts/seed-hay.ts` picks the locale from `--platform` (nuvemshop → `pt-BR`, others → `en`),
keeps the files whose `platforms` include that store, and calls `documents.create` /
`documents.update` with the markdown body as `content`, status `published`. Documents are matched
by title: a changed body is updated (and re-embedded), an identical one is skipped. Renaming a
title creates a new document; delete the old one in the dashboard.

```bash
tools/hay-cli/bin/hay demo seed hay --platform shopify --dry-run   # or:
node_modules/.bin/tsx tools/demo-account/scripts/seed-hay.ts --platform shopify --only docs
```

## Editing rules

- Never state a fact that isn't in `company/brand.md` or `catalog/products.json`. When unsure,
  leave it out: the AI is told to say "I don't know" and hand off.
- Prices and stock are not written here; the AI reads them live from the store.
- Brazil's 7-day right of withdrawal is stated as policy; the AI never computes the deadline.
- Write "Hay.chat", never bare "Hay".
