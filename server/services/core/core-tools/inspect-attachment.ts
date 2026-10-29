/**
 * `inspect_attachment` core tool (D8-13): the AI takes a second, targeted look
 * at a photo or PDF the customer sent in THIS conversation, e.g. "what is the
 * lot number on the label?" or "is the seal broken?". Read-only.
 *
 * - Only files on the customer's messages of this conversation.
 * - Honours the store's settings: nothing when image reading is off; ID
 *   documents and payment cards stay withheld (D8-12), including when the new
 *   look finds one; card numbers are removed from the answer.
 * - Usage is reported like the first pass (vision service).
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType, type MessageAttachment } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { organizationRepository } from "@server/repositories/organization.repository";
import { resolveMediaSettings } from "@server/types/organization-settings.types";
import { loadFileForVision } from "@server/services/media-analysis/pipeline";
import { withheldClass } from "@server/services/media-analysis/privacy";
import { isAnalyzable } from "@server/services/media-analysis/readable";
import { redactCardNumbers } from "@server/services/media-analysis/redact";
import { visionService } from "@server/services/media-analysis/vision.service";
import type { CoreToolDefinition } from "./index";

const logger = createLogger("core-tool:inspect-attachment");

type InspectResult =
  | { answer: string; class: string; fields: Record<string, string> }
  | { error: string };

async function findCustomerFile(
  conversation: Conversation,
  attachmentId: string,
): Promise<MessageAttachment | undefined> {
  const messages = await conversation.getMessages();
  for (const message of messages) {
    if (message.type !== MessageType.CUSTOMER) continue;
    const match = message.attachments?.find((attachment) => attachment.id === attachmentId);
    if (match) return match;
  }
  return undefined;
}

export const inspectAttachmentTool: CoreToolDefinition = {
  name: "inspect_attachment",
  description:
    "Look again at a photo or PDF the customer sent in this conversation to answer a specific question " +
    "(e.g. the lot number on a label, whether a seal is broken, the total on an invoice). " +
    "Use the file id shown in the conversation as [File <id> ...]. Read-only. " +
    "Do not use it on files marked as withheld for privacy.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["attachmentId", "question"],
    properties: {
      attachmentId: { type: "string", description: "The file id from [File <id> ...]." },
      question: { type: "string", description: "What to look for, in one sentence." },
    },
  },

  async execute(conversation, args): Promise<InspectResult> {
    const attachmentId = typeof args.attachmentId === "string" ? args.attachmentId.trim() : "";
    const question = typeof args.question === "string" ? args.question.trim().slice(0, 500) : "";
    if (!attachmentId || !question) return { error: "attachmentId and question are required" };

    const attachment = await findCustomerFile(conversation, attachmentId);
    if (!attachment || !isAnalyzable(attachment)) {
      return {
        error: "no photo or PDF with that id was sent by the customer in this conversation",
      };
    }

    const organization = await organizationRepository.findById(conversation.organization_id);
    const settings = resolveMediaSettings(organization?.settings);
    if (!settings.readImages) return { error: "image reading is turned off for this store" };
    if (attachment.analysis?.withheld) return { error: "this file is withheld for privacy" };

    try {
      const file = await loadFileForVision(conversation.organization_id, attachment.id);
      if (!file.input) return { error: "this file could not be read" };
      const result = await visionService.analyze(
        conversation.organization_id,
        file.input,
        question,
      );
      if (withheldClass(result, settings)) return { error: "this file is withheld for privacy" };

      const fields: Record<string, string> = {};
      for (const [name, value] of Object.entries(result.fields)) {
        fields[name] = redactCardNumbers(value);
      }
      return {
        answer: redactCardNumbers(result.answer ?? result.description),
        class: result.class,
        fields,
      };
    } catch (error) {
      logger.warn(
        {
          conversationId: conversation.id,
          attachmentId,
          error: error instanceof Error ? error.message : String(error),
        },
        "inspect_attachment failed",
      );
      return { error: "this file could not be read right now" };
    }
  },
};
