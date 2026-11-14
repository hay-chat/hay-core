import { serverToServerProcedure } from "@server/trpc/middleware/auth";
import { fitsInBytes, publicContextRecord } from "@server/lib/validation/json-record";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { auditLogService } from "@server/services/audit-log.service";
import { conversationSecretService } from "../../../services/conversation-secret.service";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ConversationReferenceNotFoundError,
  ConversationService,
} from "../../../services/conversation.service";
import { Message, MessageType } from "../../../database/entities/message.entity";
import { Conversation } from "../../../database/entities/conversation.entity";
import { TRPCError } from "@trpc/server";
import {
  customerLanguage,
  generateConversationTitle,
} from "../../../orchestrator/conversation-utils";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";
import { createListProcedure } from "@server/trpc/procedures/list";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { messageApprovalService } from "../../../services/message-approval.service";
import { createLogger } from "@server/lib/logger";
import { agentAvatarUrl, agentFirstName } from "../../../services/webchat/public-message";
import { announceAgentRead } from "../../../services/widget-events.service";
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
import { translationService, type TranslatedText } from "../../../services/translation.service";
import {
  CONVERSATION_TEXT_FIELDS,
  translateConversationTexts,
} from "../../../services/conversation-translations.service";
import {
  LANGUAGE_CODES,
  isLanguageCode,
  normalizeLanguage,
  shouldAdoptLanguage,
  type LanguageCode,
} from "../../../types/language.types";

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

/**
 * The only conversation metadata a dashboard or API client may set: marking a
 * playground conversation and its starting action mode. Everything else in
 * metadata (isPlayground, runKind, channel ids, ...) is set by the server and
 * decides whether writes are simulated or the conversation is billed.
 */
export function clientConversationMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  if (metadata?.sourceId === "playground") kept.sourceId = "playground";
  if (typeof metadata?.dryRun === "boolean") kept.dryRun = metadata.dryRun;
  return kept;
}

/**
 * What a dashboard or API caller's message counts as. Staff write as themselves
 * after taking over; writing as the customer is only for test conversations,
 * and nobody writes as the assistant.
 */
export function staffMessageType(
  role: "user" | "assistant",
  conversation: Pick<Conversation, "status" | "assigned_user_id" | "metadata">,
  userId: string,
): MessageType {
  if (role === "user") {
    if (!isTestConversation(conversation.metadata)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only test conversations accept messages as the customer",
      });
    }
    return MessageType.CUSTOMER;
  }
  if (conversation.status !== "human-took-over" || conversation.assigned_user_id !== userId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Take over the conversation before replying",
    });
  }
  return MessageType.HUMAN_AGENT;
}

const createConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  language: z.string().max(35).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: settableStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  /** D7-5: a test conversation that runs this playbook version (usually the draft). */
  playbookVersionOverride: z
    .object({ playbookId: z.string().uuid(), versionId: z.string().uuid() })
    .optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: settableStatusSchema.optional(),
});

const MESSAGE_CONTENT_MAX_LENGTH = 20_000;

const sendMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    content: z.string().max(MESSAGE_CONTENT_MAX_LENGTH),
    role: z.enum(["user", "assistant"]).optional().default("user"),
    /** D8-16: files from `uploadAttachment`, sent by a person who took over. */
    attachmentIds: z.array(z.string().uuid()).max(STAFF_ATTACHMENT_MAX_COUNT).optional(),
    /**
     * Multilingual inbox: a person with a translation language has their reply
     * translated into the customer's language (default true). false sends the
     * text as typed, e.g. "Send untranslated" after a failed translation.
     */
    translate: z.boolean().optional(),
    /** Language to translate the reply into, instead of the customer's. */
    targetLanguage: z.enum(LANGUAGE_CODES).optional(),
  })
  .refine((input) => input.content.trim() !== "" || (input.attachmentIds?.length ?? 0) > 0, {
    message: "A message needs text or a file",
    path: ["content"],
  });

const playbookService = new PlaybookService();

/** Messages the multilingual inbox shows translated. */
const TRANSLATABLE_MESSAGE_TYPES: readonly string[] = [
  MessageType.CUSTOMER,
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
];
/** Earlier messages sent along so short replies ("yes, that one") translate right. */
const TRANSLATION_CONTEXT_MESSAGES = 6;
const TRANSLATION_CONTEXT_MAX_CHARS = 500;

/** The messages before `first`, as "Customer: ..." lines. */
function translationContext(messages: Message[], first: Message): string {
  const before = messages.slice(0, messages.indexOf(first)).slice(-TRANSLATION_CONTEXT_MESSAGES);
  return before
    .map((message) => {
      const speaker = message.type === MessageType.CUSTOMER ? "Customer" : "Support";
      return `${speaker}: ${message.content.slice(0, TRANSLATION_CONTEXT_MAX_CHARS)}`;
    })
    .join("\n");
}

/** Base64 length of the largest conversation-media file, so zod refuses bigger bodies first. */
const STAFF_ATTACHMENT_MAX_BASE64_LENGTH =
  Math.ceil(config.storage.limits.conversationMediaMaxFileSize / 3) * 4;

const MAX_SECRETS = 32;
const MAX_SECRET_VALUE_LENGTH = 8192;
const CONVERSATION_CONTEXT_MAX_BYTES = 64 * 1024;

export const conversationsRouter = t.router({
  list: createListProcedure(
    RESOURCES.CONVERSATIONS,
    conversationListInputSchema,
    conversationRepository,
  ),

  /**
   * What the Home screen shows: conversations waiting for a human (longest wait
   * first) and the ones a human is currently handling. One query, no paging:
   * both sets are small by nature (a backlog here is the problem to surface).
   */
  attention: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ).query(async ({ ctx }) => {
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
  active: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ).query(async ({ ctx }) => {
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
      z.object({
        customerId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
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
  escalations: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
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

  escalatedConversations: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        period: z.enum(["today", "week"]),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
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

  dailyStats: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        days: z.number().int().min(1).max(366).optional().default(30),
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

  get: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
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

      // A person opening the conversation in the inbox (the dashboard reloads
      // it as messages arrive) has read the visitor's latest message: the
      // widget shows "Seen". API tokens read conversations too; they are not
      // a person reading.
      if (ctx.user?.authMethod === "jwt") {
        void announceAgentRead(conversation, conversation.messages ?? []);
      }

      return conversation;
    }),

  create: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.CREATE)
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { playbookVersionOverride, customerId, ...rest } = input;
      const data = {
        ...rest,
        customer_id: customerId,
        metadata: clientConversationMetadata(rest.metadata),
      };
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
      let conversation: Conversation;
      try {
        conversation = await conversationService.createConversation(organizationId, data);
      } catch (error) {
        if (error instanceof ConversationReferenceNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }

      return conversation;
    }),

  update: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
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

  delete: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.DELETE)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await conversationService.deleteConversation(ctx.organizationId!, input.id);

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      await auditLogService.record({
        userId: ctx.user?.id,
        organizationId: ctx.organizationId,
        action: "conversation.delete",
        resource: "conversation",
        changes: { conversationId: input.id },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { success: true };
    }),

  getMessages: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).optional().default(50),
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

  /**
   * Multilingual inbox: the conversation's customer, AI and team messages as
   * the reader sees them in `language`. Stored translations are reused; the
   * rest are translated together and stored on their message. `messageIds`
   * limits the work to those messages (e.g. new arrivals).
   */
  translateMessages: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.READ)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        language: z.enum(LANGUAGE_CODES),
        messageIds: z.array(z.string().uuid()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const { language } = input;

      const messages = (conversation.messages ?? []).filter(
        (message) => TRANSLATABLE_MESSAGE_TYPES.includes(message.type) && message.content?.trim(),
      );
      const wanted = input.messageIds ? new Set(input.messageIds) : null;
      const selected = wanted ? messages.filter((message) => wanted.has(message.id)) : messages;
      const untranslated = selected.filter(
        (message) =>
          !message.translations?.[language] &&
          normalizeLanguage(message.detectedLanguage) !== language,
      );

      let translated = new Map<string, TranslatedText>();
      if (untranslated.length) {
        try {
          translated = await translationService.translateTexts({
            organizationId: conversation.organization_id,
            items: untranslated.map((message) => ({ id: message.id, text: message.content })),
            targetLanguage: language,
            context: translationContext(messages, untranslated[0]),
          });
        } catch (error) {
          logger.error(
            { err: error, conversationId: conversation.id, language },
            "Message translation failed",
          );
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TRANSLATION_FAILED" });
        }

        await Promise.all(
          untranslated.map((message) => {
            const result = translated.get(message.id)!;
            return translationService.saveMessageTranslation({
              messageId: message.id,
              language,
              text: result.text,
              detectedLanguage: result.sourceLanguage,
            });
          }),
        );

        // The AI's language detection doesn't run while a person holds the
        // conversation, so the newest customer message sets its language here.
        const newestCustomer = untranslated.filter((m) => m.type === MessageType.CUSTOMER).pop();
        const detected = newestCustomer && translated.get(newestCustomer.id)?.sourceLanguage;
        if (
          newestCustomer &&
          shouldAdoptLanguage(newestCustomer.content, detected, conversation.language)
        ) {
          try {
            await conversationRepository.update(conversation.id, conversation.organization_id, {
              language: detected,
            });
          } catch (error) {
            logger.warn(
              { err: error, conversationId: conversation.id },
              "Failed to update the conversation's language",
            );
          }
        }
      }

      return selected.map((message) => {
        const fresh = translated.get(message.id);
        const stored = normalizeLanguage(message.detectedLanguage);
        return {
          messageId: message.id,
          text: fresh?.text ?? message.translations?.[language] ?? message.content,
          sourceLanguage: fresh?.sourceLanguage ?? stored,
        };
      });
    }),

  /**
   * Titles and hand-off summaries of the conversations on screen in the
   * reader's language, translated in one batch and cached per conversation.
   */
  translateTexts: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        conversationIds: z.array(z.string().uuid()).min(1).max(100),
        language: z.enum(LANGUAGE_CODES),
        fields: z.array(z.enum(CONVERSATION_TEXT_FIELDS)).min(1).default(["title", "summary"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await translateConversationTexts({
          organizationId: ctx.organizationId!,
          conversationIds: [...new Set(input.conversationIds)],
          language: input.language,
          fields: [...new Set(input.fields)],
        });
      } catch (error) {
        logger.error(
          { err: error, language: input.language },
          "Conversation title/summary translation failed",
        );
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "TRANSLATION_FAILED" });
      }
    }),

  sendMessage: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.CREATE)
    .input(sendMessageSchema)
    .mutation(async ({ input, ctx }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const messageType = staffMessageType(input.role, conversation, ctx.user!.id);

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
      // and their photo beside it.
      let senderFirstName: string | undefined;
      let senderAvatarUrl: string | null = null;
      let senderLanguage: LanguageCode | null = null;
      if (messageType === MessageType.HUMAN_AGENT) {
        const { userRepository } = await import("../../../repositories/user.repository");
        const sender = await userRepository.findById(ctx.user!.id);
        senderFirstName = agentFirstName(sender);
        senderAvatarUrl = agentAvatarUrl(sender);
        if (isLanguageCode(sender?.translationLanguage)) {
          senderLanguage = sender.translationLanguage;
        }
      }

      // Multilingual inbox: the customer gets the reply in their language. The
      // stored content is always what the customer sees (channel delivery sends
      // it); the text as typed is kept as the sender's translation.
      let content = input.content;
      let translations: Message["translations"] = null;
      let detectedLanguage: LanguageCode | null = null;
      if (senderLanguage && input.content.trim()) {
        translations = { [senderLanguage]: input.content };
        const target =
          input.targetLanguage ??
          normalizeLanguage(customerLanguage(conversation.messages ?? [], conversation));
        if (input.translate === false) {
          // Sent as typed: its language is unknown, the reader's translation finds it.
        } else if (target && target !== senderLanguage) {
          try {
            const result = await translationService.translateTexts({
              organizationId: conversation.organization_id,
              items: [{ id: randomUUID(), text: input.content }],
              targetLanguage: target,
            });
            content = [...result.values()][0].text;
            detectedLanguage = target;
          } catch (error) {
            logger.error(
              { err: error, conversationId: conversation.id, target },
              "Reply translation failed",
            );
            throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "TRANSLATION_FAILED" });
          }
        } else {
          detectedLanguage = senderLanguage;
        }
      }

      // The addMessage method now handles cooldown logic for Customer messages
      const message = await conversation.addMessage({
        content,
        type: messageType,
        ...(attachments.length ? { attachments } : {}),
        metadata: {
          sender: input.role || "user",
          sentByUserId: ctx.user?.id,
          agentFirstName: senderFirstName,
          ...(messageType === MessageType.HUMAN_AGENT ? { agentAvatarUrl: senderAvatarUrl } : {}),
        },
        ...(translations ? { translations } : {}),
        ...(detectedLanguage ? { detectedLanguage } : {}),
      });

      return message;
    }),

  /**
   * D8-16: store a file a person picked in the Inbox composer. Sent with the
   * next `sendMessage` (attachmentIds); unsent files are swept after a day.
   */
  uploadAttachment: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.CREATE)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        data: z.string().min(1).max(STAFF_ATTACHMENT_MAX_BASE64_LENGTH),
        mimeType: z.string().min(1).max(100),
        fileName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
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
  channelTemplates: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
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
  sendChannelTemplate: scopedProcedure(RESOURCES.MESSAGES, ACTIONS.CREATE)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        name: z.string().min(1).max(512),
        language: z.string().min(1).max(20),
        values: z.record(z.string().max(64), z.string().max(1024)).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
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
      const sender = await userRepository.findById(ctx.user!.id);
      const message = await conversation.addMessage({
        content: prepared.content,
        type: MessageType.HUMAN_AGENT,
        metadata: {
          sender: "assistant",
          sentByUserId: ctx.user?.id,
          agentFirstName: agentFirstName(sender),
          agentAvatarUrl: agentAvatarUrl(sender),
          channelTemplate: prepared.channelTemplate,
        },
      });
      return message;
    }),

  takeover: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        force: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
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
          agentAvatarUrl: agentAvatarUrl(user),
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

  release: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        returnToMode: z.enum(["ai", "queue"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
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
          agentAvatarUrl: agentAvatarUrl(user),
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

  getAssignedUser: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
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

  close: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );

      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
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
  approveMessage: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        messageId: z.string().uuid(),
        // An empty edit would be delivered as an empty bubble; reject it here.
        editedContent: z.string().trim().min(1).max(MESSAGE_CONTENT_MAX_LENGTH).optional(),
        /**
         * Language the reviewer wrote `editedContent` in; when it isn't the
         * customer's, the edit is translated before it is sent.
         */
        editedInLanguage: z.enum(LANGUAGE_CODES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return messageApprovalService.approve({
        messageId: input.messageId,
        organizationId: ctx.organizationId!,
        userId: ctx.user!.id,
        editedContent: input.editedContent,
        editedInLanguage: input.editedInLanguage,
      });
    }),

  blockMessage: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        messageId: z.string().uuid(),
        reason: z.string().max(2000).optional(),
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
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
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
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.conversationId,
        ctx.organizationId!,
      );
      if (!conversation) {
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
  setLegalHold: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.MANAGE)
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
  addSecrets: serverToServerProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        secrets: z
          .record(z.string().min(1).max(128), z.string().max(MAX_SECRET_VALUE_LENGTH))
          .refine((secrets) => Object.keys(secrets).length <= MAX_SECRETS, {
            message: `At most ${MAX_SECRETS} secrets`,
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.id,
        ctx.organizationId!,
      );
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      await conversationSecretService.setSecrets(input.id, input.secrets);
      return { success: true };
    }),

  // Merge public context into a conversation (server-to-server, API key auth)
  // Context is stored in DB conversation.context JSONB and injected into the LLM prompt
  addContext: serverToServerProcedure(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE)
    .input(
      z.object({
        id: z.string().uuid(),
        context: publicContextRecord(CONVERSATION_CONTEXT_MAX_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await conversationRepository.findByIdAndOrganization(
        input.id,
        ctx.organizationId!,
      );
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      const merged = { ...(conversation.context ?? {}), ...input.context };
      if (!fitsInBytes(merged, CONVERSATION_CONTEXT_MAX_BYTES)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Conversation context is too large" });
      }
      await conversationRepository.updateById(input.id, { context: merged });
      return { success: true };
    }),

  export: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.EXPORT)
    .input(
      z.object({
        conversationId: z.string().uuid(),
        format: z.enum(["pdf", "csv"]),
        /**
         * Adds each message in this language next to the original. Defaults to
         * the requesting person's translation language; null turns it off.
         */
        translationLanguage: z.enum(LANGUAGE_CODES).nullable().optional(),
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
      await auditLogService.record({
        userId: ctx.user?.id,
        organizationId,
        action: "conversation.export",
        resource: "conversation",
        changes: { conversationId: conversation.id, format: input.format },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      // Multilingual inbox: the content stays the record; a translation is added next to it.
      let translationLanguage = input.translationLanguage ?? null;
      if (input.translationLanguage === undefined && ctx.user) {
        const { userRepository } = await import("../../../repositories/user.repository");
        const requester = await userRepository.findById(ctx.user.id);
        if (isLanguageCode(requester?.translationLanguage)) {
          translationLanguage = requester.translationLanguage;
        }
      }
      const { translation, complete: translationComplete } = translationLanguage
        ? await conversationExportService.translate(conversation, translationLanguage)
        : { translation: undefined, complete: true };

      if (input.format === "pdf") {
        const organization = await organizationRepository.findById(organizationId);
        const pdfBuffer = await conversationExportService.generatePdf(conversation, {
          storeName: organization?.name ?? "",
          timeZone: organization?.timezone ?? "UTC",
          translation,
        });
        return {
          base64Data: pdfBuffer.toString("base64"),
          fileName: `${titleSlug}-${timestamp}.pdf`,
          mimeType: "application/pdf",
          translationIncomplete: !translationComplete,
        };
      }

      const csvContent = conversationExportService.generateCsv(conversation, translation);
      const csvBuffer = Buffer.from(csvContent, "utf-8");
      return {
        base64Data: csvBuffer.toString("base64"),
        fileName: `${titleSlug}-${timestamp}.csv`,
        mimeType: "text/csv",
        translationIncomplete: !translationComplete,
      };
    }),
});
