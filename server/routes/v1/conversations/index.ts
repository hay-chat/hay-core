import { t, authenticatedProcedure, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { conversationSecretService } from "../../../services/conversation-secret.service";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType } from "../../../database/entities/message.entity";
import { Conversation } from "../../../database/entities/conversation.entity";
import { TRPCError } from "@trpc/server";
import { generateConversationTitle } from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { messageApprovalService } from "../../../services/message-approval.service";
import { createLogger } from "@server/lib/logger";
import { agentFirstName } from "../../../services/webchat/public-message";
import { decodeBase64 } from "../../../services/webchat/widget-attachments";
import {
  STAFF_ATTACHMENT_MAX_COUNT,
  StaffAttachmentRejectedError,
  staffAttachmentsFromUploads,
  storeStaffAttachment,
} from "../../../services/staff-attachments";
import { config } from "@server/config/env";
import { ConversationExportService } from "../../../services/conversation-export.service";
import { organizationRepository } from "@server/repositories/organization.repository";
import { AppDataSource } from "../../../database/data-source";
import {
  listChannelTemplates,
  prepareChannelTemplate,
} from "../../../services/channel-templates.service";
import { isPlaygroundConversation } from "../../../services/core/dry-run";
import { isTestConversation } from "../../../services/close-classification/outcome-rules";
import { PlaybookService } from "../../../services/playbook.service";
import { notSimulationSql } from "../../../services/simulation/simulation-kind";
import { PLAYBOOK_VERSION_OVERRIDE_KEY } from "../../../services/playbook-version-override";

const logger = createLogger("conversations");
const conversationExportService = new ConversationExportService();

const conversationService = new ConversationService();
const conversationRepository = new ConversationRepository();

/**
 * Raw row shape returned by the active-conversations SQL query below.
 * Column names are snake_case because the query bypasses TypeORM mapping.
 */
interface AttentionConversationRow {
  id: string;
  title: string | null;
  status: "pending-human" | "human-took-over";
  channel: string;
  summary: string | null;
  assigned_user_id: string | null;
  updated_at: Date | string;
  last_message_at: Date | string | null;
  customer_name: string | null;
  handler_first_name: string | null;
  handler_last_name: string | null;
  handler_email: string | null;
}

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

/**
 * Statuses a client may set. "awaiting-approval" is not one: only holding an
 * action (and deciding it) moves a conversation in and out of it; set from
 * outside it would leave the conversation with no AI reply and no auto-close.
 */
const settableStatusSchema = z.enum([
  "open",
  "processing",
  "pending-human",
  "human-took-over",
  "resolved",
  "unresolved",
  "closed",
]);

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agentId: z.string().uuid().optional(),
  language: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  status: settableStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  /** D7-5: a test conversation that runs this playbook version (usually the draft). */
  playbookVersionOverride: z
    .object({ playbookId: z.string().uuid(), versionId: z.string().uuid() })
    .optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: settableStatusSchema.optional(),
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

const sendMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    content: z.string(),
    role: z.enum(["user", "assistant"]).optional().default("user"),
    /** D8-16: files from `uploadAttachment`, sent by a person who took over. */
    attachmentIds: z.array(z.string().uuid()).max(STAFF_ATTACHMENT_MAX_COUNT).optional(),
  })
  .refine((input) => input.content.trim() !== "" || (input.attachmentIds?.length ?? 0) > 0, {
    message: "A message needs text or a file",
    path: ["content"],
  });

const playbookService = new PlaybookService();

/** Base64 length of the largest conversation-media file, so zod refuses bigger bodies first. */
const STAFF_ATTACHMENT_MAX_BASE64_LENGTH =
  Math.ceil(config.storage.limits.conversationMediaMaxFileSize / 3) * 4;

export const conversationsRouter = t.router({
  list: createListProcedure(conversationListInputSchema, conversationRepository),

  /**
   * What the Home screen shows: conversations waiting for a human (longest wait
   * first) and the ones a human is currently handling. One query, no paging:
   * both sets are small by nature (a backlog here is the problem to surface).
   */
  attention: authenticatedProcedure.query(async ({ ctx }) => {
    const rows = (await AppDataSource.query(
      `
        SELECT
          c.id,
          c.title,
          c.status,
          c.channel,
          c.summary,
          c.assigned_user_id,
          c.updated_at,
          c.last_message_at,
          cust.name AS customer_name,
          u.first_name AS handler_first_name,
          u.last_name AS handler_last_name,
          u.email AS handler_email
        FROM conversations c
        LEFT JOIN customers cust ON cust.id = c.customer_id
        LEFT JOIN users u ON u.id = c.assigned_user_id
        WHERE c.organization_id = $1
          AND c.deleted_at IS NULL
          AND c.status IN ('pending-human', 'human-took-over')
          AND c.spam_flagged_at IS NULL
          AND ${notSimulationSql("c")}
        ORDER BY COALESCE(c.last_message_at, c.updated_at) ASC
        LIMIT 200
      `,
      [ctx.organizationId],
    )) as AttentionConversationRow[];

    const toView = (r: AttentionConversationRow) => ({
      id: r.id,
      title: r.title,
      customerName: r.customer_name,
      channel: r.channel,
      summary: r.summary,
      waitingSince: new Date(r.last_message_at ?? r.updated_at).toISOString(),
      assignedUserId: r.assigned_user_id,
      handlerName:
        r.handler_first_name || r.handler_last_name
          ? `${r.handler_first_name ?? ""} ${r.handler_last_name ?? ""}`.trim()
          : r.handler_email,
    });

    return {
      waiting: rows.filter((r) => r.status === "pending-human").map(toView),
      handling: rows.filter((r) => r.status === "human-took-over").map(toView),
    };
  }),

  /** Spam view (D9-7): spam-flagged conversations, newest first, with reasons. */
  spam: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const { listSpam } = await import("@server/services/spam/spam-review.service");
      return listSpam(ctx.organizationId!, input?.limit ?? 100);
    }),

  /** Flag a conversation as spam: never billed, held from the AI. */
  markSpam: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { markSpam } = await import("@server/services/spam/spam-review.service");
      await markSpam(ctx.organizationId!, input.conversationId, ctx.user!.id);
      return { success: true };
    }),

  /** Clear a spam flag; the AI answers again if the shopper is still waiting. */
  notSpam: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { markNotSpam } = await import("@server/services/spam/spam-review.service");
      return markNotSpam(ctx.organizationId!, input.conversationId, ctx.user!.id);
    }),

  /**
   * Active conversations for dashboard widgets.
   * Includes conversations handled by Hay or a human.
   */
  active: authenticatedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId;
    if (!organizationId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Organization context required" });
    }

    const statuses = [
      "open",
      "processing",
      "pending-human",
      "awaiting-approval",
      "human-took-over",
    ];

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
          AND ${notSimulationSql("c")}
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
          : { type: "hay" as const, name: "Hay.chat", userId: null },
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        canJoin: !["closed", "resolved", "unresolved"].includes(r.status),
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

      // Planned hand-offs (a playbook's "Handoff to human" step) are a designed,
      // successful outcome, not an escalation, so they are excluded here.
      const [escalationsRow] = await AppDataSource.query(
        `
          SELECT COUNT(*)::int AS count
          FROM conversation_takeover_events e
          JOIN conversations c ON c.id = e.conversation_id
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
            AND (c.metadata->>'plannedHandoff') IS DISTINCT FROM 'true'
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
            AND ${notSimulationSql("c")}
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
          JOIN conversations c ON c.id = e.conversation_id
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
            AND (c.metadata->>'plannedHandoff') IS DISTINCT FROM 'true'
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
          JOIN conversations c ON c.id = e.conversation_id
          WHERE e.organization_id = $1
            AND e.started_at >= $2
            AND e.started_at <= $3
            AND (c.metadata->>'plannedHandoff') IS DISTINCT FROM 'true'
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
      const { playbookVersionOverride, ...data } = input;
      if (playbookVersionOverride) {
        if (!isTestConversation(data.metadata)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only test conversations can run a playbook draft",
          });
        }
        const version = await playbookService
          .getVersion(
            organizationId,
            playbookVersionOverride.playbookId,
            playbookVersionOverride.versionId,
          )
          .catch(() => null);
        if (!version) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Playbook version not found" });
        }
        data.metadata = {
          ...data.metadata,
          [PLAYBOOK_VERSION_OVERRIDE_KEY]: playbookVersionOverride,
        };
      }
      const conversation = await conversationService.createConversation(organizationId, data);

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
      if (["closed", "resolved", "unresolved"].includes(input.data.status ?? "")) {
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

    // D8-16: only a person who took over sends files (delivered by the channel).
    let attachments: Awaited<ReturnType<typeof staffAttachmentsFromUploads>> = [];
    if (input.attachmentIds?.length) {
      if (messageType !== MessageType.HUMAN_AGENT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Take over the conversation before sending files",
        });
      }
      try {
        attachments = await staffAttachmentsFromUploads({
          organizationId: conversation.organization_id,
          userId: ctx.user!.id,
          uploadIds: input.attachmentIds,
        });
      } catch (error) {
        if (!(error instanceof StaffAttachmentRejectedError)) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
    }

    // The widget shows a person's reply as "10:42 · Marina" (first name only)
    let senderFirstName: string | undefined;
    if (messageType === MessageType.HUMAN_AGENT) {
      const { userRepository } = await import("../../../repositories/user.repository");
      senderFirstName = agentFirstName(await userRepository.findById(ctx.user!.id));
    }

    // The addMessage method now handles cooldown logic for Customer messages
    const message = await conversation.addMessage({
      content: input.content,
      type: messageType,
      ...(attachments.length ? { attachments } : {}),
      metadata: {
        sender: input.role || "user",
        sentByUserId: ctx.user?.id,
        agentFirstName: senderFirstName,
      },
    });

    return message;
  }),

  /**
   * D8-16: store a file a person picked in the Inbox composer. Sent with the
   * next `sendMessage` (attachmentIds); unsent files are swept after a day.
   */
  uploadAttachment: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        data: z.string().min(1).max(STAFF_ATTACHMENT_MAX_BASE64_LENGTH),
        mimeType: z.string().min(1).max(100),
        fileName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (
        conversation.status !== "human-took-over" ||
        conversation.assigned_user_id !== ctx.user?.id
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Take over the conversation before sending files",
        });
      }
      const buffer = decodeBase64(input.data);
      if (!buffer) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file data" });
      }
      try {
        return await storeStaffAttachment({
          organizationId: conversation.organization_id,
          userId: ctx.user!.id,
          buffer,
          mimeType: input.mimeType,
          filename: input.fileName,
        });
      } catch (error) {
        if (!(error instanceof StaffAttachmentRejectedError)) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
    }),

  /**
   * D13-3: templates the conversation's channel can send now (e.g. WhatsApp
   * templates once the 24 h reply window closed). `supported: false` when the
   * channel has none.
   */
  channelTemplates: authenticatedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      try {
        return await listChannelTemplates(conversation.organization_id, conversation.channel);
      } catch (error) {
        logger.warn({ err: error, conversationId: conversation.id }, "Channel templates failed");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Could not load templates from the channel",
        });
      }
    }),

  /**
   * D13-3: a person sends an approved channel template (human-started only).
   * Stored as a human-agent message with the rendered text; the channel plugin
   * sends the template itself from `metadata.channelTemplate` on delivery.
   */
  sendChannelTemplate: authenticatedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        name: z.string().min(1).max(512),
        language: z.string().min(1).max(20),
        values: z.record(z.string().max(64), z.string().max(1024)).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (
        conversation.status !== "human-took-over" ||
        conversation.assigned_user_id !== ctx.user?.id
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Take over the conversation before sending a template",
        });
      }

      let prepared: Awaited<ReturnType<typeof prepareChannelTemplate>>;
      try {
        prepared = await prepareChannelTemplate({
          organizationId: conversation.organization_id,
          channel: conversation.channel,
          name: input.name,
          language: input.language,
          values: input.values,
        });
      } catch (error) {
        logger.warn({ err: error, conversationId: conversation.id }, "Channel templates failed");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Could not load templates from the channel",
        });
      }
      if ("error" in prepared) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            prepared.error === "missing_variables"
              ? "Fill in every template variable"
              : "This template is not available on the channel",
        });
      }

      const { userRepository } = await import("../../../repositories/user.repository");
      const message = await conversation.addMessage({
        content: prepared.content,
        type: MessageType.HUMAN_AGENT,
        metadata: {
          sender: "assistant",
          sentByUserId: ctx.user?.id,
          agentFirstName: agentFirstName(await userRepository.findById(ctx.user!.id)),
          channelTemplate: prepared.channelTemplate,
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
      if (["closed", "resolved", "unresolved"].includes(conversation.status)) {
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
          // Shown to the shopper as "Marina joined the chat" (first name only)
          systemEvent: "agent_joined",
          agentFirstName: agentFirstName(user),
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
          // Shown to the shopper as "Marina left the chat" (+ "AI again" when returned to AI)
          systemEvent: input.returnToMode === "ai" ? "agent_returned_to_ai" : "agent_left",
          agentFirstName: agentFirstName(user),
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
          // Shown to the shopper as "Marina left the chat" (+ "AI again" when returned to AI)
          systemEvent: input.returnToMode === "ai" ? "agent_returned_to_ai" : "agent_left",
          agentFirstName: agentFirstName(user),
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

  /**
   * Release a reply held by approval mode. Delivery to the customer (webchat,
   * WhatsApp, Instagram, ...) happens inside the service.
   */
  approveMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        // An empty edit would be delivered as an empty bubble; reject it here.
        editedContent: z.string().trim().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return messageApprovalService.approve({
        messageId: input.messageId,
        organizationId: ctx.organizationId!,
        userId: ctx.user!.id,
        editedContent: input.editedContent,
      });
    }),

  blockMessage: authenticatedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return messageApprovalService.block({
        messageId: input.messageId,
        organizationId: ctx.organizationId!,
        userId: ctx.user!.id,
        reason: input.reason,
      });
    }),

  /**
   * Switch a playground conversation between simulated actions (dry-run, the
   * default) and the live store. Only playground conversations can be switched.
   */
  // D8-15: send a complete product-problem case to the store's case address again.
  forwardProductCase: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const { forwardProductCase } = await import("../../../services/product-case/forward");
      const forward = await forwardProductCase(conversation.id, ctx.organizationId!);
      if (!forward) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This conversation has no complete product case",
        });
      }
      return forward;
    }),

  setDryRun: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ conversationId: z.string().uuid(), dryRun: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation || conversation.organization_id !== ctx.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (!isPlaygroundConversation(conversation.metadata)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only playground conversations can switch between simulated and live actions",
        });
      }
      const metadata = { ...(conversation.metadata ?? {}), dryRun: input.dryRun };
      await conversationRepository.updateById(conversation.id, { metadata });
      logger.info(
        { conversationId: conversation.id, userId: ctx.user?.id, dryRun: input.dryRun },
        "Playground action mode changed",
      );
      return { dryRun: input.dryRun };
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
        const organization = await organizationRepository.findById(organizationId);
        const pdfBuffer = await conversationExportService.generatePdf(conversation, {
          storeName: organization?.name ?? "",
          timeZone: organization?.timezone ?? "UTC",
        });
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
