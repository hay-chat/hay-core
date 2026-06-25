import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { conversationSecretService } from "../../../services/conversation-secret.service";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType, MessageStatus } from "../../../database/entities/message.entity";
import { Conversation } from "../../../database/entities/conversation.entity";
import { TRPCError } from "@trpc/server";
import { generateConversationTitle } from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { MessageRepository } from "@server/repositories/message.repository";
import { DeliveryState } from "@server/types/message-feedback.types";
import { createLogger } from "@server/lib/logger";
import { ConversationExportService } from "../../../services/conversation-export.service";
import { AppDataSource } from "../../../database/data-source";

const logger = createLogger("conversations");
const conversationExportService = new ConversationExportService();

const conversationService = new ConversationService();
const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();

/**
 * Raw row shape returned by the active-conversations SQL query below.
 * Column names are snake_case because the query bypasses TypeORM mapping.
 */
interface ActiveConversationRow {
  id: string;
  title: string | null;
  status: string;
  assigned_user_id: string | null;
  updated_at: Date | string | null;
  customer_name: string | null;
  customer_external_id: string | null;
  handler_first_name: string | null;
  handler_last_name: string | null;
  last_message_at: Date | string | null;
}

/**
 * Raw row shape returned by the by-customer SQL query below.
 */
interface CustomerConversationRow {
  id: string;
  title: string | null;
  status: string;
  channel: string | null;
  created_at: Date | string | null;
  last_message_at: Date | string | null;
  message_count: number | string | null;
}

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  language: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  status: z
    .enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"])
    .optional(),
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z
    .enum(["open", "processing", "pending-human", "human-took-over", "resolved", "closed"])
    .optional(),
  metadata: z.record(z.any()).optional(),
  customer_id: z.string().uuid().optional(),
});

const messageSchema = z.object({
  type: z.nativeEnum(MessageType),
  content: z.string(),
  usage_metadata: z.record(z.any()).optional(),
});

const addMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: messageSchema,
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string(),
  role: z.enum(["user", "assistant"]).optional().default("user"),
});

export const conversationsRouter = t.router({
  list: createListProcedure(conversationListInputSchema, conversationRepository),

  /**
   * Active conversations for dashboard widgets.
   * Includes conversations handled by Hay or a human.
   */
  active: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId;
    if (!organizationId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
    }

    const statuses = ["open", "processing", "pending-human", "human-took-over"];

    const rows = await AppDataSource.query(
      `
        SELECT
          c.id,
          c.title,
          c.status,
          c.assigned_user_id,
          c.updated_at,
          cust.name AS customer_name,
          cust.external_id AS customer_external_id,
          u.first_name AS handler_first_name,
          u.last_name AS handler_last_name,
          (
            SELECT MAX(m.created_at)
            FROM messages m
            WHERE m.conversation_id = c.id
          ) AS last_message_at
        FROM conversations c
        LEFT JOIN customers cust ON cust.id = c.customer_id
        LEFT JOIN users u ON u.id = c.assigned_user_id
        WHERE c.organization_id = $1
          AND c.deleted_at IS NULL
          AND c.status = ANY($2)
        ORDER BY last_message_at DESC NULLS LAST, c.updated_at DESC
        LIMIT 5
      `,
      [organizationId, statuses],
    );

    return ((rows as ActiveConversationRow[]) || []).map((r) => {
      const handlerName =
        r.handler_first_name || r.handler_last_name
          ? `${r.handler_first_name || ""} ${r.handler_last_name || ""}`.trim()
          : null;

      const isHuman = r.status === "human-took-over" && !!r.assigned_user_id;

      return {
        id: r.id,
        title: r.title || null,
        customer: {
          name: r.customer_name || null,
          externalId: r.customer_external_id || null,
        },
        status: r.status,
        handler: isHuman
          ? { type: "human" as const, name: handlerName, userId: r.assigned_user_id }
          : { type: "hay" as const, name: "Hay", userId: null },
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        canJoin: !["closed", "resolved"].includes(r.status),
      };
    });
  }),

  /**
   * All conversations for a given customer, newest activity first.
   * Powers the "Previous Conversations" panel and the customer profile page.
   */
  byCustomer: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({ customerId: z.string().uuid(), limit: z.number().min(1).max(100).default(50) }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
      }

      const rows = await AppDataSource.query(
        `
          SELECT
            c.id,
            c.title,
            c.status,
            c.channel,
            c.created_at,
            (
              SELECT MAX(m.created_at)
              FROM messages m
              WHERE m.conversation_id = c.id
            ) AS last_message_at,
            (
              SELECT COUNT(*)
              FROM messages m
              WHERE m.conversation_id = c.id
            ) AS message_count
          FROM conversations c
          WHERE c.organization_id = $1
            AND c.customer_id = $2
            AND c.deleted_at IS NULL
          ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT $3
        `,
        [organizationId, input.customerId, input.limit],
      );

      return ((rows as CustomerConversationRow[]) || []).map((r) => ({
        id: r.id,
        title: r.title || null,
        status: r.status,
        channel: r.channel || null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        messageCount: r.message_count != null ? Number(r.message_count) : 0,
      }));
    }),

  /**
   * Escalation (takeover) counts for dashboard widgets.
   */
  escalations: authenticatedProcedure
    .input(z.object({ period: z.enum(["today", "week"]) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
      }

      const now = new Date();
      let start: Date;
      if (input.period === "today") {
        start = new Date(now);
        start.setUTCHours(0, 0, 0, 0);
      } else {
        // ISO week starting Monday in UTC
        start = new Date(now);
        const day = start.getUTCDay(); // 0(Sun)..6
        const diffToMonday = (day + 6) % 7;
        start.setUTCDate(start.getUTCDate() - diffToMonday);
        start.setUTCHours(0, 0, 0, 0);
      }

      const [escalationsRow] = await AppDataSource.query(
        `
          SELECT COUNT(*)::int AS count
          FROM conversation_takeover_events e
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
        `,
        [organizationId, start.toISOString(), now.toISOString()],
      );

      const [conversationsRow] = await AppDataSource.query(
        `
          SELECT COUNT(*)::int AS count
          FROM conversations c
          WHERE c.organization_id = $1
            AND c.deleted_at IS NULL
            AND c.created_at >= $2
            AND c.created_at <= $3
        `,
        [organizationId, start.toISOString(), now.toISOString()],
      );

      const totalEscalations = escalationsRow?.count ?? 0;
      const totalConversations = conversationsRow?.count ?? 0;

      // Percentage of conversations in period that had at least one takeover event
      const [uniqueConversationsRow] = await AppDataSource.query(
        `
          SELECT COUNT(DISTINCT e.conversation_id)::int AS count
          FROM conversation_takeover_events e
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
        `,
        [organizationId, start.toISOString(), now.toISOString()],
      );

      const conversationsWithEscalation = uniqueConversationsRow?.count ?? 0;
      const percentage =
        totalConversations > 0 ? (conversationsWithEscalation / totalConversations) * 100 : null;

      return {
        period: input.period,
        totalEscalations,
        totalConversations,
        conversationsWithEscalation,
        percentage,
        window: { start: start.toISOString(), end: now.toISOString() },
      };
    }),

  escalatedConversations: authenticatedProcedure
    .input(
      z.object({ period: z.enum(["today", "week"]), limit: z.number().optional().default(50) }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
      }

      const now = new Date();
      let start: Date;
      if (input.period === "today") {
        start = new Date(now);
        start.setUTCHours(0, 0, 0, 0);
      } else {
        start = new Date(now);
        const day = start.getUTCDay();
        const diffToMonday = (day + 6) % 7;
        start.setUTCDate(start.getUTCDate() - diffToMonday);
        start.setUTCHours(0, 0, 0, 0);
      }

      const idsRows = await AppDataSource.query(
        `
          SELECT DISTINCT e.conversation_id AS id
          FROM conversation_takeover_events e
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
          ORDER BY e.conversation_id
          LIMIT $4
        `,
        [organizationId, start.toISOString(), now.toISOString(), input.limit],
      );

      const ids = ((idsRows as Array<{ id: string }>) || []).map((r) => r.id).filter(Boolean);
      if (ids.length === 0) return [];

      // Return full conversation objects so the existing conversations table can render.
      const repo = AppDataSource.getRepository(Conversation);
      const conversations = await repo
        .createQueryBuilder("conversation")
        .where("conversation.organization_id = :organizationId", { organizationId })
        .andWhere("conversation.deleted_at IS NULL")
        .andWhere("conversation.id IN (:...ids)", { ids })
        .leftJoinAndSelect("conversation.assignedUser", "assignedUser")
        .leftJoinAndSelect("conversation.customer", "customer")
        .leftJoinAndSelect("conversation.messages", "messages")
        .orderBy("conversation.updated_at", "DESC")
        .getMany();

      return conversations;
    }),

  dailyStats: authenticatedProcedure
    .input(
      z.object({
        days: z.number().optional().default(30),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const stats = await conversationService.getDailyConversationStats(
        ctx.organizationId!,
        input.days,
        input.startDate ? new Date(input.startDate) : undefined,
        input.endDate ? new Date(input.endDate) : undefined,
      );
      return stats;
    }),

  listByAgent: authenticatedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversations = await conversationService.getConversationsByAgent(
        ctx.organizationId!,
        input.agentId,
      );
      return conversations;
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }
      const conversation = await conversationService.getConversation(input.id, organizationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return conversation;
    }),

  create: authenticatedProcedure
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      // Organization ID must come from auth context or explicit input field (validated as UUID above)
      const organizationId = ctx.organizationId || input.organizationId;
      if (!organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization ID is required",
        });
      }
      const conversation = await conversationService.createConversation(organizationId, input);

      return conversation;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateConversationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationService.updateConversation(
        input.id,
        ctx.organizationId!,
        input.data,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Generate title when conversation is closed or resolved
      if (input.data.status === "closed" || input.data.status === "resolved") {
        await generateConversationTitle(input.id, ctx.organizationId!, false);
      }

      return conversation;
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await conversationService.deleteConversation(ctx.organizationId!, input.id);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return { success: true };
    }),

  getMessages: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conversation = await conversationService.getConversation(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const messages = input.limit
        ? await conversationService.getLastMessages(
            input.conversationId,
            ctx.organizationId!,
            input.limit,
          )
        : await conversationService.getMessages(input.conversationId);

      return messages;
    }),

  addMessage: authenticatedProcedure.input(addMessageSchema).mutation(async ({ ctx, input }) => {
    const conversation = await conversationService.getConversation(
      input.conversationId,
      ctx.organizationId!,
    );

    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // The addMessage method now handles cooldown logic for Customer messages
    const message = await conversation.addMessage({
      content: input.message.content,
      type: input.message.type,
      metadata: input.message.usage_metadata,
    });

    // Resolution detection is now handled by the perception layer
    // which checks for MessageIntent.CLOSE_SATISFIED or CLOSE_UNSATISFIED

    return message;
  }),

  sendMessage: authenticatedProcedure.input(sendMessageSchema).mutation(async ({ input, ctx }) => {
    const conversation = await conversationRepository.findById(input.conversationId);

    if (!conversation) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // Verify organization access
    if (conversation.organization_id !== ctx.organizationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // Determine message type based on role and takeover status
    let messageType: MessageType;
    if (input.role === "assistant") {
      // If conversation is taken over by current user, it's a human agent message
      const isTakenOverByCurrentUser =
        conversation.status === "human-took-over" && conversation.assigned_user_id === ctx.user?.id;

      messageType = isTakenOverByCurrentUser ? MessageType.HUMAN_AGENT : MessageType.BOT_AGENT;
    } else {
      messageType = MessageType.CUSTOMER;
    }

    // The addMessage method now handles cooldown logic for Customer messages
    const message = await conversation.addMessage({
      content: input.content,
      type: messageType,
      metadata: {
        sender: input.role || "user",
        sentByUserId: ctx.user?.id,
      },
    });

    return message;
  }),

  takeover: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        force: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Check if conversation is already closed or resolved
      if (["closed", "resolved"].includes(conversation.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot take over a closed or resolved conversation",
        });
      }

      // Check if already taken over by another user
      if (
        conversation.status === "human-took-over" &&
        conversation.assigned_user_id &&
        conversation.assigned_user_id !== ctx.user?.id &&
        !input.force
      ) {
        // Return current owner info for confirmation dialog
        const { userRepository } = await import("../../../repositories/user.repository");
        const currentOwner = await userRepository.findById(conversation.assigned_user_id);

        throw new TRPCError({
          code: "CONFLICT",
          message: "Conversation is already taken over by another user",
          cause: {
            currentOwner: {
              id: currentOwner?.id,
              name: currentOwner?.getFullName(),
              email: currentOwner?.email,
            },
          },
        });
      }

      const previousOwnerId = conversation.assigned_user_id;

      // Assign to current user
      await conversation.assignToUser(ctx.user!.id);

      // Log escalation/takeover event (best effort)
      try {
        const { conversationTakeoverEventRepository } =
          await import("../../../repositories/conversation-takeover-event.repository");
        await conversationTakeoverEventRepository.startTakeover({
          organizationId: ctx.organizationId!,
          conversationId: conversation.id,
          userId: ctx.user!.id,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to log takeover event");
      }

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      await conversation.addMessage({
        content: `${user?.getFullName() || "User"} took over this conversation`,
        type: MessageType.SYSTEM,
        metadata: {
          isTakeoverMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_taken_over",
        payload: {
          conversationId: conversation.id,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
          previousOwnerId,
        },
      });

      return conversation;
    }),

  release: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        returnToMode: z.enum(["ai", "queue"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Verify user is the one who took over
      if (conversation.assigned_user_id !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only release conversations assigned to you",
        });
      }

      // Release conversation
      await conversation.releaseFromUser(input.returnToMode);

      // Close the most recent open takeover event (best effort)
      try {
        const { conversationTakeoverEventRepository } =
          await import("../../../repositories/conversation-takeover-event.repository");
        await conversationTakeoverEventRepository.endMostRecentOpenTakeover({
          organizationId: ctx.organizationId!,
          conversationId: conversation.id,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to close takeover event");
      }

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      const releaseMessage =
        input.returnToMode === "ai"
          ? `${user?.getFullName() || "User"} returned this conversation to AI`
          : `${user?.getFullName() || "User"} returned this conversation to the queue`;

      await conversation.addMessage({
        content: releaseMessage,
        type: MessageType.SYSTEM,
        metadata: {
          isReleaseMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
          returnToMode: input.returnToMode,
        },
      });

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_released",
        payload: {
          conversationId: conversation.id,
          newStatus: conversation.status,
          releasedBy: ctx.user!.id,
          userName: user?.getFullName(),
          returnToMode: input.returnToMode,
        },
      });

      return conversation;
    }),

  getAssignedUser: authenticatedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      if (!conversation.assigned_user_id) {
        return null;
      }

      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(conversation.assigned_user_id);

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        name: user.getFullName(),
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        assignedAt: conversation.assigned_at,
      };
    }),

  close: authenticatedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      // Verify organization access
      if (conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      // Verify user is the one who took over (if conversation is taken over)
      if (
        conversation.status === "human-took-over" &&
        conversation.assigned_user_id !== ctx.user!.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only close conversations assigned to you",
        });
      }

      // Close conversation
      await conversation.closeConversation();

      // Add system message
      const { userRepository } = await import("../../../repositories/user.repository");
      const user = await userRepository.findById(ctx.user!.id);
      await conversation.addMessage({
        content: `${user?.getFullName() || "User"} closed this conversation`,
        type: MessageType.SYSTEM,
        metadata: {
          isCloseMessage: true,
          userId: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      // Generate conversation title
      await generateConversationTitle(input.conversationId, ctx.organizationId!, false);

      // Emit WebSocket event
      const { websocketService } = await import("../../../services/websocket.service");
      websocketService.sendToOrganization(ctx.organizationId!, {
        type: "conversation_closed",
        payload: {
          conversationId: conversation.id,
          closedBy: ctx.user!.id,
          userName: user?.getFullName(),
        },
      });

      return conversation;
    }),

  approveMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        editedContent: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await messageRepository.findById(input.messageId);

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify organization access through conversation
      const conversation = await conversationRepository.findById(message.conversation_id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify message is in queued state
      if (message.deliveryState !== DeliveryState.QUEUED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message is not in queued state",
        });
      }

      // If content was edited, store original content
      const wasEdited = input.editedContent && input.editedContent !== message.content;
      const updates: Partial<typeof message> = {
        status: wasEdited ? MessageStatus.EDITED : MessageStatus.APPROVED,
        deliveryState: DeliveryState.SENT,
        approvedBy: ctx.user!.id,
        approvedAt: new Date(),
      };

      if (wasEdited) {
        updates.originalContent = message.content;
        updates.content = input.editedContent;
      }

      const updatedMessage = await messageRepository.update(message.id, updates);

      // Broadcast message approval to WebSocket clients
      try {
        const { redisService } = await import("../../../services/redis.service");

        if (redisService.isConnected()) {
          await redisService.publish("websocket:events", {
            type: "message_approved",
            organizationId: conversation.organization_id,
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              editedContent: input.editedContent,
            },
          });
        } else {
          // Fallback to direct WebSocket if Redis not available
          const { websocketService } = await import("../../../services/websocket.service");
          websocketService.sendToOrganization(conversation.organization_id, {
            type: "message_approved",
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              editedContent: input.editedContent,
            },
          });
        }
      } catch (error) {
        logger.error({ err: error }, "Failed to publish approval event");
      }

      // TODO: Trigger actual message delivery to customer via WebSocket/plugin
      // This would be handled by the orchestrator or messaging service

      return updatedMessage;
    }),

  blockMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await messageRepository.findById(input.messageId);

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify organization access through conversation
      const conversation = await conversationRepository.findById(message.conversation_id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      // Verify message is in queued state
      if (message.deliveryState !== DeliveryState.QUEUED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message is not in queued state",
        });
      }

      // Update message to blocked state
      const updatedMessage = await messageRepository.update(message.id, {
        status: MessageStatus.REJECTED,
        deliveryState: DeliveryState.BLOCKED,
        approvedBy: ctx.user!.id,
        approvedAt: new Date(),
        metadata: {
          ...(message.metadata || {}),
          blockReason: input.reason,
        },
      });

      // Broadcast message block to WebSocket clients
      try {
        const { redisService } = await import("../../../services/redis.service");

        if (redisService.isConnected()) {
          await redisService.publish("websocket:events", {
            type: "message_blocked",
            organizationId: conversation.organization_id,
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              reason: input.reason,
            },
          });
        } else {
          // Fallback to direct WebSocket if Redis not available
          const { websocketService } = await import("../../../services/websocket.service");
          websocketService.sendToOrganization(conversation.organization_id, {
            type: "message_blocked",
            payload: {
              conversationId: message.conversation_id,
              messageId: message.id,
              messageType: message.type,
              reason: input.reason,
            },
          });
        }
      } catch (error) {
        logger.error({ err: error }, "Failed to publish block event");
      }

      return updatedMessage;
    }),

  /**
   * Set or remove legal hold on a conversation
   * Conversations with legal hold are exempt from automatic data retention anonymization
   */
  setLegalHold: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        legalHold: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { dataRetentionService } = await import("../../../services/data-retention.service");

      const conversation = await dataRetentionService.setLegalHold(
        input.conversationId,
        ctx.organizationId!,
        input.legalHold,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return {
        success: true,
        legalHold: conversation.legal_hold,
        legalHoldSetAt: conversation.legal_hold_set_at,
      };
    }),

  // Attach server-side secrets to a conversation (server-to-server, API key auth)
  // Secrets are stored in Redis, never reach the LLM — injected into MCP tool calls only
  addSecrets: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ id: z.string().uuid(), secrets: z.record(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      await conversationSecretService.setSecrets(input.id, input.secrets);
      return { success: true };
    }),

  // Merge public context into a conversation (server-to-server, API key auth)
  // Context is stored in DB conversation.context JSONB and injected into the LLM prompt
  addContext: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ id: z.string().uuid(), context: z.record(z.any()) }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.id);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const merged = { ...(conversation.context ?? {}), ...input.context };
      await conversationRepository.updateById(input.id, { context: merged });
      return { success: true };
    }),

  export: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        format: z.enum(["pdf", "csv"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId;
      if (!organizationId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Organization context required",
        });
      }

      const conversation = await conversationService.getConversation(
        input.conversationId,
        organizationId,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const titleSlug = (conversation.title || "conversation")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      const timestamp = new Date().toISOString().slice(0, 10);

      if (input.format === "pdf") {
        const pdfBuffer = await conversationExportService.generatePdf(conversation);
        return {
          base64Data: pdfBuffer.toString("base64"),
          fileName: `${titleSlug}-${timestamp}.pdf`,
          mimeType: "application/pdf",
        };
      }

      const csvContent = conversationExportService.generateCsv(conversation);
      const csvBuffer = Buffer.from(csvContent, "utf-8");
      return {
        base64Data: csvBuffer.toString("base64"),
        fileName: `${titleSlug}-${timestamp}.csv`,
        mimeType: "text/csv",
      };
    }),
});
