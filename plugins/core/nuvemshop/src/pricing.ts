/**
 * Canonical prices for a Nuvemshop variant. Nuvemshop's `price` is the regular
 * price and `promotional_price` the sale price; canonically the selling price
 * goes in `price` and the regular price in `compareAtPrice` (Shopify-style).
 *
 * The promotional price counts only when it is a real discount: > 0 and below
 * the regular price. Stores leave "0.00" (or a stale higher value) behind when a
 * promotion ends, and that must never become the selling price.
 */
export function variantPricing(
  price: string | null | undefined,
  promotionalPrice: string | null | undefined,
): { price?: number; compareAtPrice?: number } {
  const regular = price ? parseFloat(price) : NaN;
  const promotional = promotionalPrice ? parseFloat(promotionalPrice) : NaN;
  const hasRegular = Number.isFinite(regular);
  const onSale =
    Number.isFinite(promotional) && promotional > 0 && (!hasRegular || promotional < regular);
  if (onSale) {
    return { price: promotional, compareAtPrice: hasRegular ? regular : undefined };
  }
  return { price: hasRegular ? regular : undefined, compareAtPrice: undefined };
}
