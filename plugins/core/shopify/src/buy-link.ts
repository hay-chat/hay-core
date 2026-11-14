/**
 * Shopify cart permalink: `https://<store>/cart/<variant id>:<quantity>` opens
 * checkout with that variant. Built from the product's online store URL (the
 * storefront's primary domain) and the variant's numeric id.
 */
export function cartPermalink(
  onlineStoreUrl: string | null | undefined,
  variantGid: string,
): string | undefined {
  const variantId = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(variantGid)?.[1];
  if (!onlineStoreUrl || !variantId) return undefined;
  try {
    return `${new URL(onlineStoreUrl).origin}/cart/${variantId}:1`;
  } catch {
    return undefined;
  }
}
