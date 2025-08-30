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
    agentId: z.string().uuid().optional(),
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
    .optional()
    .default({}),
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
export const conversationFiltersSchema = z
  .object({
    status: z
      .enum(["open", "processing", "pending-human", "resolved", "closed"])
      .optional(),
    agentId: z.string().uuid().optional(),
    playbookId: z.string().uuid().optional(),
    hasMessages: z.boolean().optional(),
  })
  .optional();

// Conversation list input schema
export const conversationListInputSchema = baseListInputSchema.extend({
  filters: conversationFiltersSchema,
  sorting: z
    .object({
      orderBy: z
        .enum([
          "created_at",
          "updated_at",
          "title",
          "status",
          "last_user_message_at",
        ])
        .default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional()
    .default({}),
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

// Agent-specific filters
export const agentFiltersSchema = z
  .object({
    enabled: z.boolean().optional(),
    hasPlaybooks: z.boolean().optional(),
  })
  .optional();

// Agent list input schema
export const agentListInputSchema = baseListInputSchema.extend({
  filters: agentFiltersSchema,
  sorting: z
    .object({
      orderBy: z
        .enum(["created_at", "updated_at", "name", "enabled"])
        .default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional()
    .default({}),
  search: z
    .object({
      query: z.string().optional(),
      searchFields: z
        .array(z.enum(["name", "description"]))
        .optional()
        .default(["name", "description"]),
    })
    .optional(),
});

// Playbook-specific filters
export const playbookFiltersSchema = z
  .object({
    status: z.enum(["active", "inactive", "draft"]).optional(),
    agentIds: z.array(z.string().uuid()).optional(),
  })
  .optional();

// Playbook list input schema
export const playbookListInputSchema = baseListInputSchema.extend({
  filters: playbookFiltersSchema,
  sorting: z
    .object({
      orderBy: z
        .enum(["created_at", "updated_at", "name", "status"])
        .default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional()
    .default({}),
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
    type: z.enum(["HUMAN_MESSAGE", "AI_MESSAGE", "SYSTEM_MESSAGE"]).optional(),
    sender: z.string().optional(),
  })
  .optional();

// Message list input schema
export const messageListInputSchema = baseListInputSchema.extend({
  filters: messageFiltersSchema,
  sorting: z
    .object({
      orderBy: z
        .enum(["created_at", "updated_at", "type"])
        .default("created_at"),
      orderDirection: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional()
    .default({}),
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
export type AgentListInput = z.infer<typeof agentListInputSchema>;
export type PlaybookListInput = z.infer<typeof playbookListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
