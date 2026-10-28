import { EventSubscriber, type EntitySubscriberInterface, type InsertEvent } from "typeorm";
import { Message } from "../entities/message.entity";

/**
 * D2-4: index order numbers mentioned in new messages ("#1001", "pedido 1001").
 * Runs after the insert and is not awaited, so it never slows down or breaks
 * a message write; the write uses its own connection, outside the insert's
 * transaction.
 */
@EventSubscriber()
export class OrderLinkMessageSubscriber implements EntitySubscriberInterface<Message> {
  listenTo() {
    return Message;
  }

  afterInsert(event: InsertEvent<Message>): void {
    const message = event.entity;
    if (!message?.id || !message.conversation_id || !message.content) return;
    const { id, conversation_id, type, content } = message;
    // Imported lazily: the service imports the data source, which loads this file.
    void import("../../services/order-links/order-link.service")
      .then(({ orderLinkService }) =>
        orderLinkService.recordFromMessage({ id, conversation_id, type, content }),
      )
      .catch(() => undefined);
  }
}
