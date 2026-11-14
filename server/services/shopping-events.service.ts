/**
 * Shopping funnel events: what a shopper did with a recommended product.
 *
 * The widget reports clicks without a DPoP proof (a click must not contend
 * with the chat's nonce chain), so a click only counts when it names a real
 * ProductRecommendation message of that conversation and a product that
 * message showed. The ids are only known to the shopper and the merchant.
 */

import { AppDataSource } from "@server/database/data-source";
import { MessageType } from "@server/database/entities/message.entity";
import {
  ShoppingEvent,
  type ShoppingEventType,
} from "@server/database/entities/shopping-event.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { messageRepository } from "@server/repositories/message.repository";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("shopping-events");

export interface ProductClick {
  conversationId: string;
  messageId: string;
  productId: string;
  type: ShoppingEventType;
}

/** Whether a ProductRecommendation message's metadata lists this product. */
export function recommendationShowsProduct(metadata: unknown, productId: string): boolean {
  const products = (metadata as { productRecommendation?: { products?: unknown } } | null)
    ?.productRecommendation?.products;
  return (
    Array.isArray(products) &&
    products.some((product) => (product as { id?: unknown } | null)?.id === productId)
  );
}

/**
 * Record a click on a recommended product. Returns whether it was recorded;
 * never throws, so a failed write (or a pending migration) cannot break the
 * shopper's click.
 */
export async function recordProductClick(click: ProductClick): Promise<boolean> {
  try {
    const message = await messageRepository.findById(click.messageId);
    if (
      !message ||
      message.conversation_id !== click.conversationId ||
      message.type !== MessageType.PRODUCT_RECOMMENDATION ||
      !recommendationShowsProduct(message.metadata, click.productId)
    ) {
      return false;
    }
    const conversation = await conversationRepository.findById(click.conversationId);
    if (!conversation) return false;

    await AppDataSource.getRepository(ShoppingEvent).insert({
      organizationId: conversation.organization_id,
      conversationId: click.conversationId,
      messageId: click.messageId,
      productId: click.productId,
      type: click.type,
    });
    return true;
  } catch (err) {
    logger.warn({ err, conversationId: click.conversationId }, "Could not record product click");
    return false;
  }
}
