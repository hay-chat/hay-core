# Demo account: Casa Aurora

A reproducible test environment for Hay.chat: a fake home-goods brand with the same catalogue,
customers and orders in three e-commerce stores, plus the Hay.chat side (knowledge base, playbooks,
agent) for each store's org. Seed it, run the conversation scenarios, re-seed to reset.

Everything is fake: shoppers use `@example.com`, CPFs are generated, and every store order is a test
order with customer emails off. Use **test stores only**, never a real merchant's store.

## What's here

| Path                             | What                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `company/brand.md`               | The company: stores, team, hours, policies, voice. Source of truth for policy facts.   |
| `catalog/`                       | 22 products (en + pt-BR, USD/EUR/BRL), 44 placeholder images. See `catalog/README.md`. |
| `orders/orders.json`             | 14 order fixtures in fixed states, the same in every store.                            |
| `orders/customers.json`          | 15 fake shoppers, 5 per store.                                                         |
| `knowledge/`                     | Knowledge-base documents, en and pt-BR.                                                |
| `playbooks/<platform>/`          | Playbooks per store, using that store's plugin actions. Nuvemshop in pt-BR.           |
| `SCENARIOS.md`                   | 57 conversation test scenarios from the VOC research, mapped to the features they test. |
| `scripts/`                       | Seed scripts (one per store + Hay.chat), image generator, tests.                       |

The three stores:

| Store              | Platform    | Market   | Currency | Language |
| ------------------ | ----------- | -------- | -------- | -------- |
| Casa Aurora (US)   | Shopify     | US       | USD      | en       |
| Casa Aurora Europe | WooCommerce | Portugal | EUR      | en       |
| Casa Aurora Brasil | Nuvemshop   | Brazil   | BRL      | pt-BR    |

The order fixtures are: paid not shipped, wrong address, scent swap, in transit, stale tracking
(12 days), delivered, delivered damaged, delivered 45 days ago, pending payment, refunded, partially
refunded, cancelled unpaid, high value (over the approval threshold), delivered but "never arrived".

## Quick start

1. Copy the env file and fill the stores you use:

   ```bash
   cp tools/demo-account/.env.example tools/demo-account/.env
   ```

   - **Hay.chat:** log in with the hay CLI as usual (`tools/hay-cli/.env` or `hay login`), and set
     `HAY_ORG_SHOPIFY` / `HAY_ORG_WOOCOMMERCE` / `HAY_ORG_NUVEMSHOP` to the org each store is connected to.
   - **Shopify:** a custom app on the dev store with `write_products`, `write_inventory`,
     `read_locations`, `write_files`, `write_customers`, `write_orders`, `write_fulfillments`,
     `write_merchant_managed_fulfillment_orders`. Put its Admin API token in `SHOPIFY_ADMIN_TOKEN`.
   - **WooCommerce:** wp-admin → WooCommerce → Settings → Advanced → REST API → Add key (Read/Write).
     Optional `WP_USER` + `WP_APP_PASSWORD` (Users → Profile → Application Passwords) to upload images.
   - **Nuvemshop:** a custom app on the store (Aplicativos a medida) with read/write on products, orders,
     fulfillment orders and customers. The Hay.chat partner app can't create products, so it can't be reused.

2. Preview, then seed:

   ```bash
   tools/hay-cli/bin/hay demo seed all --dry-run
   ```

   ```bash
   tools/hay-cli/bin/hay demo seed all
   ```

   `all` seeds every store with keys and skips the rest. One store: `hay demo seed shopify` (seeds the
   store and its Hay.chat org). Only Hay.chat: `hay demo seed hay --org <id>`.

3. Run scenarios from `SCENARIOS.md` with the hay CLI, e.g.

   ```bash
   tools/hay-cli/bin/hay chat send "Hi, where is my order? I'm emily.carter@example.com" --logs
   ```

   Real order numbers per fixture are in `orders/seeded-<platform>.json` after a seed run.

4. Reset: `hay demo seed <store> --reset-orders` deletes the demo orders and recreates them in their
   starting states. Products and customers are updated in place on every run.

Flags for `hay demo seed`: `--dry-run`, `--reset-orders`, `--image-base-url <url>` (products take
images from that URL instead of uploading local files), plus the CLI's `--target` and `--org`.
The scripts also run on their own: `node_modules/.bin/tsx tools/demo-account/scripts/seed-<x>.ts --help`
style flags (`--only products|customers|orders`, `--orders key1,key2`; seed-hay: `--platform`,
`--draft`, `--quick-check on|off`, `--only settings,agent,docs,playbooks`).

## What each platform can't reproduce

None of the store scripts has run against a real store yet; the first run on each confirms the points below.

- **Shopify:** orders are backdated with `processedAt`, but `createdAt` is always the seed time, and
  the Hay.chat Shopify plugin reads `createdAt`, so orders look placed today. Tracking events are
  backdated, so delivered and stale tracking work. Card payments are recorded as an external `card` gateway.
- **WooCommerce:** the REST API can't backdate. After a real run the script saves a `wp eval` command
  (`backdateCommand` in `orders/seeded-woocommerce.json`); run it with WP-CLI on the WordPress host.
  There is no delivered status: delivered = completed + a note. The script sets the store currency to
  EUR, the country to PT and turns off 9 order emails (`--keep-emails` skips that).
- **Nuvemshop:** order dates, refunded/voided payment statuses and delivered tracking events are best
  guesses from the plugin's code (the API docs weren't reachable when this was written); the script
  falls back and notes what it did in each order's `owner_note`. Seeded Pix orders have no real Pix code.
- **Images:** the default image URL is this repo's `master`, which only resolves after merge. Until then
  Shopify uses staged uploads, Nuvemshop base64, and WooCommerce needs `WP_USER` + `WP_APP_PASSWORD`
  or `--image-base-url`.
- **Hay.chat seed:** makes "Casa Aurora Assistant" the org's default agent and publishes the playbooks
  (`--draft` to keep them drafts), so point it at demo orgs only.

## Development

```bash
node_modules/.bin/vitest run --root tools/demo-account
node_modules/.bin/tsc --noEmit -p tools/demo-account/tsconfig.json
npx eslint "tools/demo-account/**/*.ts"
tools/hay-cli/bin/hay demo images     # regenerate catalog/images from catalog/products.json
```

To add a product: add it to `catalog/products.json`, add its drawing in `scripts/generate-images.ts`,
run `hay demo images`, then re-seed. To add an order state: add a fixture to `orders/orders.json`; each
seed script maps `financialStatus` / `fulfillmentStatus` to its platform.
