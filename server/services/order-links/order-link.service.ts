/**
 * The order index (D2-4): which conversations talked about which order.
 * Written from plugin tool calls (ToolExecutionService.recordAction) and from
 * message text (OrderLinkMessageSubscriber); existing messages are indexed by
 * `npm run order-links:backfill`. Read by the evidence pack (D2-5).
 *
 * Writes never throw: a failed index write must not break a conversation.
 */
import { AppDataSource } from "@server/database/data-source";
import {
  OrderConversationLink,
  type OrderLinkSource,
} from "@server/database/entities/order-conversation-link.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { splitToolName } from "../dispute-evidence/tool-output";
import { notSimulationSql } from "../simulation/simulation-kind";
import {
  normalizeOrderToken,
  ordersFromText,
  ordersFromToolInput,
  ordersFromToolOutput,
  type OrderRef,
} from "./order-extract";

const logger = createLogger("order-links");

/** Message types whose text may name an order (people and the AI, not tools or prompts). */
const TEXT_TYPES = new Set<string>([
  MessageType.CUSTOMER,
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
]);

export interface ToolCallLinkInput {
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  /** Null for core tools, which never name a store order. */
  pluginId: string | null;
  toolName: string;
  input: unknown;
  /** The tool's answer; only read when the call succeeded. */
  output?: unknown;
}

export interface OrderGroup {
  /** Plugin that knows the order; null when only message text named it. */
  pluginId: string | null;
  orderKey: string;
  orderLabel: string | null;
  conversationIds: string[];
  lastSeenAt: Date;
}

interface LinkRow {
  conversation_id: string;
  message_id: string | null;
  plugin_id: string | null;
  order_key: string;
  order_label: string | null;
  source: OrderLinkSource;
}

export class OrderLinkService {
  /** Links from a plugin tool call: its arguments, and its answer when it succeeded. */
  async recordFromToolCall(call: ToolCallLinkInput): Promise<void> {
    if (!call.pluginId) return;
    const refs = [
      ...ordersFromToolInput(call.toolName, call.input),
      ...(call.output !== undefined ? ordersFromToolOutput(call.toolName, call.output) : []),
    ];
    await this.insert(
      call.organizationId,
      refs.map((ref) => this.row(call.conversationId, call.messageId, call.pluginId, ref)),
    );
  }

  /** Links from a message's text ("#1001", "pedido 1001"). Org comes from the conversation. */
  async recordFromMessage(message: {
    id: string;
    conversation_id: string;
    type: string;
    content: string | null;
  }): Promise<void> {
    if (!TEXT_TYPES.has(message.type)) return;
    const refs = ordersFromText(message.content);
    if (refs.length === 0) return;
    try {
      const conversation = await AppDataSource.query(
        `SELECT organization_id FROM conversations WHERE id = $1`,
        [message.conversation_id],
      );
      const organizationId = conversation[0]?.organization_id;
      if (!organizationId) return;
      await this.insert(
        organizationId,
        refs.map((ref) => this.row(message.conversation_id, message.id, null, ref)),
      );
    } catch (err) {
      logger.warn({ err, messageId: message.id }, "Failed to index order mentions");
    }
  }

  /**
   * Index existing messages in pages (keyset on id). Idempotent (unique index).
   * Tool messages carry their call as metadata (toolName, toolInput, toolOutput).
   */
  async backfill(options: { batchSize?: number; organizationId?: string } = {}): Promise<number> {
    const batchSize = options.batchSize ?? 500;
    let cursor: string | null = null;
    let scanned = 0;
    for (;;) {
      const params: unknown[] = [batchSize];
      const where: string[] = [`m.type IN ('Customer', 'BotAgent', 'HumanAgent', 'Tool')`];
      if (options.organizationId) {
        params.push(options.organizationId);
        where.push(`c.organization_id = $${params.length}`);
      }
      if (cursor) {
        params.push(cursor);
        where.push(`m.id > $${params.length}`);
      }
      const rows: Array<{
        id: string;
        conversation_id: string;
        organization_id: string;
        type: string;
        content: string | null;
        metadata: Record<string, unknown> | null;
      }> = await AppDataSource.query(
        `SELECT m.id, m.conversation_id, c.organization_id, m.type, m.content, m.metadata
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE ${where.join(" AND ")}
          ORDER BY m.id
          LIMIT $1`,
        params,
      );
      if (rows.length === 0) break;
      for (const message of rows) {
        if (message.type === MessageType.TOOL) {
          const metadata = message.metadata ?? {};
          if (typeof metadata.toolName !== "string") continue;
          const { pluginId, toolName } = splitToolName(metadata.toolName);
          await this.recordFromToolCall({
            organizationId: message.organization_id,
            conversationId: message.conversation_id,
            messageId: message.id,
            pluginId,
            toolName,
            input: metadata.toolInput,
            output: metadata.toolStatus === "SUCCESS" ? metadata.toolOutput : undefined,
          });
        } else {
          const refs = ordersFromText(message.content);
          await this.insert(
            message.organization_id,
            refs.map((ref) => this.row(message.conversation_id, message.id, null, ref)),
          );
        }
      }
      scanned += rows.length;
      cursor = rows[rows.length - 1].id;
    }
    return scanned;
  }

  /**
   * Orders matching a typed order number or id, or all orders of a
   * conversation or customer. Links are grouped per (plugin, order); a group
   * also takes in links that name the same order by its other identifier
   * (id vs number) and the plugin-less links from message text.
   */
  async findOrders(
    organizationId: string,
    filter: { query?: string; conversationId?: string; customerId?: string },
  ): Promise<OrderGroup[]> {
    const repo = AppDataSource.getRepository(OrderConversationLink);
    // Simulation conversations never count as order history (evidence goes to the bank).
    const qb = repo
      .createQueryBuilder("l")
      .innerJoin("conversations", "c", "c.id = l.conversation_id")
      .where("l.organization_id = :organizationId", { organizationId })
      .andWhere(notSimulationSql("c"));
    if (filter.query !== undefined) {
      const token = normalizeOrderToken(filter.query);
      if (!token) return [];
      qb.andWhere("(l.order_key = :token OR l.order_label = :token)", { token });
    }
    if (filter.conversationId) {
      qb.andWhere("l.conversation_id = :conversationId", { conversationId: filter.conversationId });
    }
    if (filter.customerId) {
      qb.andWhere("c.customer_id = :customerId", { customerId: filter.customerId });
    }
    const seeds = await qb.orderBy("l.created_at", "DESC").limit(200).getMany();
    if (seeds.length === 0) return [];

    // Every identifier the seeds use, then every link (any conversation) using one.
    const tokens = new Set<string>();
    for (const link of seeds) {
      tokens.add(link.order_key);
      if (link.order_label) tokens.add(link.order_label);
    }
    const related = await repo
      .createQueryBuilder("l")
      .innerJoin("conversations", "c", "c.id = l.conversation_id")
      .where("l.organization_id = :organizationId", { organizationId })
      .andWhere(notSimulationSql("c"))
      .andWhere("(l.order_key IN (:...tokens) OR l.order_label IN (:...tokens))", {
        tokens: [...tokens],
      })
      .getMany();
    return groupLinks(related);
  }

  /** Conversation ids for one order, as findOrders groups them. */
  async conversationsForOrder(
    organizationId: string,
    orderKey: string,
    pluginId: string | null,
  ): Promise<OrderGroup | null> {
    const groups = await this.findOrders(organizationId, { query: orderKey });
    return (
      groups.find((g) => g.pluginId === pluginId && g.orderKey === orderKey) ??
      groups.find((g) => g.pluginId === pluginId && g.orderLabel === orderKey) ??
      null
    );
  }

  private row(
    conversationId: string,
    messageId: string | null,
    pluginId: string | null,
    ref: OrderRef,
  ): LinkRow {
    return {
      conversation_id: conversationId,
      message_id: messageId,
      plugin_id: pluginId,
      order_key: ref.key,
      order_label: ref.label,
      source: ref.source,
    };
  }

  private async insert(organizationId: string, rows: LinkRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      // Simulation conversations are not indexed: their replies never reached anyone.
      const ids = [...new Set(rows.map((row) => row.conversation_id))];
      const simulated: Array<{ id: string }> = await AppDataSource.query(
        `SELECT c.id FROM conversations c WHERE c.id = ANY($1) AND NOT (${notSimulationSql("c")})`,
        [ids],
      );
      if (simulated.length) {
        const skip = new Set(simulated.map((c) => c.id));
        rows = rows.filter((row) => !skip.has(row.conversation_id));
        if (rows.length === 0) return;
      }
      await AppDataSource.createQueryBuilder()
        .insert()
        .into(OrderConversationLink)
        .values(rows.map((row) => ({ ...row, organization_id: organizationId })))
        .orIgnore()
        .updateEntity(false)
        .callListeners(false)
        .execute();
    } catch (err) {
      logger.warn({ err, conversationId: rows[0].conversation_id }, "Failed to write order links");
    }
  }
}

/**
 * One group per (plugin, order). Links that share an identifier are one
 * order; plugin-less (message text) links join every plugin group they match,
 * or form their own group when no plugin ever named that order.
 */
export function groupLinks(
  links: Array<
    Pick<
      OrderConversationLink,
      "plugin_id" | "order_key" | "order_label" | "conversation_id" | "created_at"
    >
  >,
): OrderGroup[] {
  type Group = OrderGroup & { tokens: Set<string> };
  const groups: Group[] = [];
  const pluginLinks = links.filter((l) => l.plugin_id !== null);
  const textLinks = links.filter((l) => l.plugin_id === null);

  const add = (group: Group, link: (typeof links)[number]) => {
    group.tokens.add(link.order_key);
    if (link.order_label) group.tokens.add(link.order_label);
    if (!group.conversationIds.includes(link.conversation_id)) {
      group.conversationIds.push(link.conversation_id);
    }
    if (link.created_at > group.lastSeenAt) group.lastSeenAt = link.created_at;
    // Prefer the platform id as the key and keep any known order number.
    if (link.order_label && !group.orderLabel) group.orderLabel = link.order_label;
    if (link.order_key !== link.order_label && group.orderKey === group.orderLabel) {
      group.orderKey = link.order_key;
    }
  };
  const matches = (group: Group, link: (typeof links)[number]) =>
    group.tokens.has(link.order_key) ||
    (link.order_label !== null && group.tokens.has(link.order_label));

  // Links whose label points at a known id come first, so id-only links can join them.
  const ordered = [...pluginLinks].sort(
    (a, b) => Number(b.order_label !== null) - Number(a.order_label !== null),
  );
  for (const link of ordered) {
    let group = groups.find((g) => g.pluginId === link.plugin_id && matches(g, link));
    if (!group) {
      group = {
        pluginId: link.plugin_id,
        orderKey: link.order_key,
        orderLabel: link.order_label,
        conversationIds: [],
        lastSeenAt: link.created_at,
        tokens: new Set(),
      };
      groups.push(group);
    }
    add(group, link);
  }
  for (const link of textLinks) {
    const targets = groups.filter((g) => g.pluginId !== null && matches(g, link));
    if (targets.length > 0) {
      targets.forEach((g) => add(g, link));
      continue;
    }
    let group = groups.find((g) => g.pluginId === null && matches(g, link));
    if (!group) {
      group = {
        pluginId: null,
        orderKey: link.order_key,
        orderLabel: link.order_label,
        conversationIds: [],
        lastSeenAt: link.created_at,
        tokens: new Set(),
      };
      groups.push(group);
    }
    add(group, link);
  }
  return groups
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .map(({ tokens: _tokens, ...group }) => group);
}

export const orderLinkService = new OrderLinkService();
