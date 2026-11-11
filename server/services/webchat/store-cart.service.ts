/**
 * Store cart: whether the page a shopper is chatting from can add to the cart
 * of the store whose catalog we mirror.
 *
 * It can when a product-source plugin contributed its cart requests (`cart@1`)
 * and the page is on that catalog's own site. The widget says it knows how to
 * run them when its socket identifies; from then on the assistant is offered
 * the `add_to_cart` and `go_to_checkout` tools, which run in that browser.
 */

import { Not, IsNull } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductStatus } from "@server/entities/product.entity";
import { createLogger } from "@server/lib/logger";
import { pageToolService } from "./page-tools.service";
import { webchatExtensionsService } from "./webchat-extensions.service";

const logger = createLogger("store-cart");

const siteOf = (hostname: string) => hostname.replace(/^www\./, "").toLowerCase();

/** The site a catalog source sells on, read from one of its products. */
async function catalogSite(organizationId: string, source: string): Promise<string | null> {
  const product = await AppDataSource.getRepository(Product).findOne({
    where: { organizationId, source, status: ProductStatus.ACTIVE, sourceUrl: Not(IsNull()) },
    select: { id: true, sourceUrl: true },
  });
  try {
    return product?.sourceUrl ? siteOf(new URL(product.sourceUrl).hostname) : null;
  } catch {
    return null;
  }
}

/** The catalog source whose cart a page on `pageHostname` can use, if any. */
export async function storeCartSourceForPage(
  organizationId: string,
  pageHostname: string | null,
): Promise<string | null> {
  if (!pageHostname) return null;
  for (const cart of await webchatExtensionsService.resolveCarts(organizationId)) {
    if (cart.type !== "cart@1") continue;
    if ((await catalogSite(organizationId, cart.source)) === siteOf(pageHostname)) {
      return cart.source;
    }
  }
  return null;
}

/**
 * A widget identified into a conversation: record whether it can add to the
 * store's cart from this page. Never throws: the chat works without it.
 */
export async function registerStoreCart(
  conversationId: string,
  organizationId: string,
  pageHostname: string | null,
  widgetSupportsCart: boolean,
): Promise<void> {
  try {
    const source = widgetSupportsCart
      ? await storeCartSourceForPage(organizationId, pageHostname)
      : null;
    await pageToolService.registerStoreCart(conversationId, source);
  } catch (err) {
    logger.warn({ err, conversationId }, "Could not register the store cart");
  }
}
