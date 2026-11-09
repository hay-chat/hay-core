import { z } from "zod";
import { baseListInputSchema } from "./list-input";
import {
  DocumentationType,
  DocumentationStatus,
  DocumentVisibility,
} from "../entities/document.entity";

// Document-specific filters
export const documentFiltersSchema = z
  .object({
    type: z.nativeEnum(DocumentationType).optional(),
    status: z.nativeEnum(DocumentationStatus).optional(),
    visibility: z.nativeEnum(DocumentVisibility).optional(),
    playbookId: z.string().uuid().optional(),
  })
  .optional();

// Document list input schema
export const documentListInputSchema = baseListInputSchema.extend({
  filters: documentFiltersSchema,
  sorting: z
    .object({
      orderBy: z
        .enum(["created_at", "updated_at", "title", "type", "status"])
        .default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .prefault({}),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z
        .array(z.enum(["title", "content"]))
        .optional()
        .default(["title", "content"]),
    })
    .optional(),
});

// Conversation-specific filters
const conversationStatusSchema = z.enum([
  "open",
  "processing",
  "pending-human",
  "awaiting-approval",
  "human-took-over",
  "resolved",
  "unresolved",
  "closed",
]);

export const conversationFiltersSchema = z
  .object({
    status: conversationStatusSchema.optional(),
    /** Any of these statuses; for filters that span several (e.g. escalated). */
    statuses: z.array(conversationStatusSchema).min(1).max(8).optional(),
    playbookId: z.string().uuid().optional(),
    hasMessages: z.boolean().optional(),
    /** Leaves out playground chats, for counts of real customer conversations. */
    excludePlayground: z.boolean().optional(),
  })
  .optional();

// Conversation list input schema
export const conversationListInputSchema = baseListInputSchema.extend({
  filters: conversationFiltersSchema,
  sorting: z
    .object({
      orderBy: z.enum(["created_at", "updated_at", "title", "status"]).default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .prefault({}),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z
        .array(z.enum(["title"]))
        .optional()
        .default(["title"]),
    })
    .optional(),
});

// Playbook-specific filters
export const playbookFiltersSchema = z
  .object({
    status: z.enum(["active", "inactive", "draft"]).optional(),
  })
  .optional();

// Playbook list input schema
export const playbookListInputSchema = baseListInputSchema.extend({
  filters: playbookFiltersSchema,
  sorting: z
    .object({
      orderBy: z.enum(["created_at", "updated_at", "name", "status"]).default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .prefault({}),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z
        .array(z.enum(["name", "description", "prompt_template"]))
        .optional()
        .default(["name", "description"]),
    })
    .optional(),
});

// Message-specific filters
export const messageFiltersSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    type: z.enum(["CUSTOMER", "BOT_AGENT", "SYSTEM"]).optional(),
    sender: z.string().optional(),
  })
  .optional();

// Message list input schema
export const messageListInputSchema = baseListInputSchema.extend({
  filters: messageFiltersSchema,
  sorting: z
    .object({
      orderBy: z.enum(["created_at", "updated_at", "type"]).default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .prefault({}),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z
        .array(z.enum(["content"]))
        .optional()
        .default(["content"]),
    })
    .optional(),
});

// Type exports
export type DocumentListInput = z.infer<typeof documentListInputSchema>;
export type ConversationListInput = z.infer<typeof conversationListInputSchema>;
export type PlaybookListInput = z.infer<typeof playbookListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
