# Casa Aurora catalogue

The product catalogue shared by the three demo stores (Shopify, WooCommerce, Nuvemshop). Brand,
policies and voice are in `../company/brand.md`; the JSON shape is `Product` in
`../scripts/lib/types.ts`, and seed scripts read it through `loadProducts()` in `../scripts/lib/data.ts`.

## What's here

- `products.json`: 22 products, 37 variant SKUs, in five categories (candles 5, pots-and-vases 5,
  cups-and-mugs 4, napkins-and-linen 4, serving 4). Every product has en + pt-BR title, description
  and details, and prices in USD, EUR and BRL (BRL priced for Brazil, e.g. `119.9` = R$ 119,90, not a
  conversion).
- `images/`: 44 placeholder PNGs (1200×1200, about 1.7 MB in total, each under 60 KB), two per product:
  `<handle>-1.png` is the main shot, `<handle>-2.png` a closer "lifestyle" shot on a table, drawn in the
  second variant's colour when there is one. Each carries a small "DEMO" mark.

## Fixtures worth knowing

These exist so specific support questions have a known answer:

| Scenario                     | Product / SKU                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Out of stock                 | Mini Succulent Pots, Set of 3 (`CA-POT-003-SET`, stock 0)                                                                     |
| Low stock                    | Terra Three-Wick Candle (`CA-CND-004-AMB`, stock 2)                                                                           |
| On sale (`compareAtPrice`)   | Lavender Travel Tin, Candle Trio Gift Set, Mar Glass Vase, Mug Set of 4, Linen Table Runner                                   |
| Care exception               | Gold-Rim Espresso Cups (`CA-MUG-003-SET`): hand wash only, not dishwasher or microwave safe. All other mugs and cups are both |
| Variant price override       | Planter Large (`CA-POT-002-L`), Tablecloth 150 × 250 cm (`CA-LIN-001-250`)                                                    |
| Scent swap (same price)      | Aurora Soy Candle: Sandalwood, Fig, Orange Blossom, Eucalyptus                                                                |
| Fragile (damaged-in-transit) | All ceramics, glass and glass-jar candles (14 products)                                                                       |

Facts the details bullets state, kept consistent with `brand.md`: 100 % soy wax, paraffin-free,
allergen-free wax and cotton wick (the lavender fragrance lists linalool); trim the wick to 5 mm and burn
2–4 hours; burn times per candle; ceramics have lead-free glazes; pots have a drainage hole and are
frost-safe to −5 °C (vases are watertight, no hole); the everyday mug holds 350 ml; candles are
hand-poured in São Paulo, ceramics handmade in Cunha (SP), linen sewn in São Paulo; the oak tray and olive
wood servers are made in Portugal.

Variant option values (`"Sandalwood"`, `"Large"`) are English in every store, because `ProductVariant.options`
is not localized. Option names (`Scent` / `Aroma`) are.

## Regenerating the images

From the repo root:

```bash
/home/user/hay-core/node_modules/.bin/tsx tools/demo-account/scripts/generate-images.ts
```

It reads `products.json`, draws each product as SVG (one drawer per handle in `DRAWERS`) and renders it to
PNG with Playwright's Chromium. If the repo's Playwright build has no matching browser download, the script
uses the newest `chromium_headless_shell-*` already in `PLAYWRIGHT_BROWSERS_PATH` (or
`~/.cache/ms-playwright`), so there's no `playwright install` step. A new product needs a drawer in
`DRAWERS`, and new option colours go in `OPTION_COLOUR`; the script fails loudly on a handle it can't draw.

## SKUs

SKU pattern: `CA-<CAT>-<NNN>-<OPT>` (CND candles, POT pots, VAS vases, MUG cups and mugs, NAP napkins,
LIN table linen, SRV serving). Prices are per variant (USD / EUR / BRL).

| SKU            | Product                          | Option         | USD / EUR / BRL                | Stock | Fragile |
| -------------- | -------------------------------- | -------------- | ------------------------------ | ----- | ------- |
| CA-CND-001-SAN | Aurora Soy Candle                | Sandalwood     | $32 / €29 / R$ 119,90          | 40    | yes     |
| CA-CND-001-FIG | Aurora Soy Candle                | Fig            | $32 / €29 / R$ 119,90          | 25    | yes     |
| CA-CND-001-ORA | Aurora Soy Candle                | Orange Blossom | $32 / €29 / R$ 119,90          | 18    | yes     |
| CA-CND-001-EUC | Aurora Soy Candle                | Eucalyptus     | $32 / €29 / R$ 119,90          | 30    | yes     |
| CA-CND-002-LAV | Lavender Travel Tin              | —              | $14 / €12.50 / R$ 49,90 (sale) | 60    | no      |
| CA-CND-003-SET | Candle Trio Gift Set             | —              | $58 / €52 / R$ 219,90 (sale)   | 22    | yes     |
| CA-CND-004-AMB | Terra Three-Wick Candle          | —              | $64 / €58 / R$ 239,90          | 2     | yes     |
| CA-CND-005-BRS | Brass Wick Trimmer               | —              | $19 / €17 / R$ 69,90           | 35    | no      |
| CA-POT-001-TER | Terracotta Plant Pot with Saucer | Terracotta     | $22 / €19 / R$ 69,90           | 50    | yes     |
| CA-POT-001-WHT | Terracotta Plant Pot with Saucer | Whitewash      | $22 / €19 / R$ 69,90           | 20    | yes     |
| CA-POT-002-M   | Speckled Stoneware Planter       | Medium         | $48 / €44 / R$ 179,90          | 14    | yes     |
| CA-POT-002-L   | Speckled Stoneware Planter       | Large          | $68 / €62 / R$ 249,90          | 9     | yes     |
| CA-POT-003-SET | Mini Succulent Pots, Set of 3    | —              | $29 / €26 / R$ 99,90           | 0     | yes     |
| CA-VAS-001-WHT | Arco Bud Vase                    | White          | $26 / €24 / R$ 89,90           | 30    | yes     |
| CA-VAS-001-SND | Arco Bud Vase                    | Sand           | $26 / €24 / R$ 89,90           | 12    | yes     |
| CA-VAS-002-BLU | Mar Glass Vase                   | Sea Blue       | $45 / €39 / R$ 159,90 (sale)   | 16    | yes     |
| CA-VAS-002-CLR | Mar Glass Vase                   | Clear          | $45 / €39 / R$ 159,90 (sale)   | 10    | yes     |
| CA-MUG-001-SND | Stoneware Mug                    | Sand           | $24 / €22 / R$ 79,90           | 45    | yes     |
| CA-MUG-001-SLT | Stoneware Mug                    | Slate          | $24 / €22 / R$ 79,90           | 28    | yes     |
| CA-MUG-001-SAG | Stoneware Mug                    | Sage           | $24 / €22 / R$ 79,90           | 33    | yes     |
| CA-MUG-002-SET | Stoneware Mug Set of 4           | —              | $86 / €79 / R$ 279,90 (sale)   | 15    | yes     |
| CA-MUG-003-SET | Gold-Rim Espresso Cups, Set of 2 | —              | $38 / €34 / R$ 129,90          | 20    | yes     |
| CA-MUG-004-SND | Lua Stoneware Tumbler            | Sand           | $18 / €16 / R$ 59,90           | 40    | yes     |
| CA-MUG-004-SLT | Lua Stoneware Tumbler            | Slate          | $18 / €16 / R$ 59,90           | 26    | yes     |
| CA-NAP-001-NAT | Linen Napkins, Set of 4          | Natural        | $42 / €38 / R$ 149,90          | 36    | no      |
| CA-NAP-001-TER | Linen Napkins, Set of 4          | Terracotta     | $42 / €38 / R$ 149,90          | 20    | no      |
| CA-NAP-001-SAG | Linen Napkins, Set of 4          | Sage           | $42 / €38 / R$ 149,90          | 18    | no      |
| CA-NAP-001-CHR | Linen Napkins, Set of 4          | Charcoal       | $42 / €38 / R$ 149,90          | 12    | no      |
| CA-NAP-002-SET | Gingham Cotton Napkins, Set of 6 | —              | $34 / €30 / R$ 119,90          | 24    | no      |
| CA-LIN-001-150 | Linen Tablecloth                 | 150 × 150 cm   | $89 / €79 / R$ 329,90          | 10    | no      |
| CA-LIN-001-250 | Linen Tablecloth                 | 150 × 250 cm   | $119 / €109 / R$ 429,90        | 8     | no      |
| CA-LIN-002-NAT | Linen Table Runner               | Natural        | $39 / €35 / R$ 139,90 (sale)   | 18    | no      |
| CA-LIN-002-CHR | Linen Table Runner               | Charcoal       | $39 / €35 / R$ 139,90 (sale)   | 14    | no      |
| CA-SRV-001-OAK | Oak Serving Tray                 | —              | $72 / €64 / R$ 269,90          | 19    | no      |
| CA-SRV-002-WHT | Large Stoneware Serving Bowl     | —              | $54 / €48 / R$ 189,90          | 12    | yes     |
| CA-SRV-003-SND | Stoneware Pitcher                | —              | $49 / €44 / R$ 169,90          | 7     | yes     |
| CA-SRV-004-OLV | Olive Wood Salad Servers         | —              | $28 / €25 / R$ 89,90           | 30    | no      |
