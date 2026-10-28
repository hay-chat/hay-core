import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { In } from "typeorm";
import { t, scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { AppDataSource } from "@server/database/data-source";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { auditLogService } from "@server/services/audit-log.service";
import { orderLinkService, type OrderGroup } from "@server/services/order-links/order-link.service";
import { disputeEvidenceService } from "@server/services/dispute-evidence/dispute-evidence.service";
import { buildEvidenceZip } from "@server/services/dispute-evidence/evidence-zip";
import { orderSummaryFrom } from "@server/services/dispute-evidence/order-summary";
import { EVIDENCE_TEMPLATES } from "@server/services/dispute-evidence/copy";
import { safeTimeZone } from "@server/utils/zoned-datetime";

/**
 * Evidence packs (D2-5): find an order's conversations and download them as
 * one dispute evidence PDF, or a ZIP with the PDF, attachments, a SHA-256
 * manifest and a README. Available on every plan; uses only what the org's
 * retention setting still keeps.
 */

function platformName(pluginId: string | null): string | null {
  if (!pluginId) return null;
  return pluginManagerService.getPlugin(pluginId)?.name ?? null;
}

function toOrderResponse(group: OrderGroup) {
  return {
    pluginId: group.pluginId,
    platform: platformName(group.pluginId),
    orderKey: group.orderKey,
    orderLabel: group.orderLabel,
    conversationCount: group.conversationIds.length,
    lastSeenAt: group.lastSeenAt,
  };
}

/** Total and date from the latest tool answer in these conversations that described the order. */
async function orderSummary(conversationIds: string[], group: OrderGroup) {
  const tokens = new Set([group.orderKey, ...(group.orderLabel ? [group.orderLabel] : [])]);
  const toolMessages = await AppDataSource.getRepository(Message).find({
    where: { conversation_id: In(conversationIds), type: MessageType.TOOL },
    order: { created_at: "DESC" },
    take: 200,
  });
  for (const message of toolMessages) {
    if (message.metadata?.toolStatus !== "SUCCESS") continue;
    const summary = orderSummaryFrom(message.metadata?.toolOutput, tokens);
    if (summary) return summary;
  }
  return { total: null, placedAt: null };
}

const fileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "pack";

export const evidencePacksRouter = t.router({
  /** Orders by typed number or id, or every order a conversation or customer talked about. */
  searchOrders: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z.object({
        query: z.string().trim().min(1).max(64).optional(),
        conversationId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const organization = await organizationRepository.findById(organizationId);
      const hasFilter = input.query || input.conversationId || input.customerId;
      const groups = hasFilter ? await orderLinkService.findOrders(organizationId, input) : [];
      return {
        orders: groups.slice(0, 50).map(toOrderResponse),
        retentionDays: organization?.settings?.retentionDays ?? null,
      };
    }),

  /** Build the pack for one order, or for one conversation when it names no order. */
  generate: scopedProcedure(RESOURCES.CONVERSATIONS, ACTIONS.READ)
    .input(
      z
        .object({
          orderKey: z.string().trim().min(1).max(64).optional(),
          pluginId: z.string().max(255).nullable().optional(),
          conversationId: z.string().uuid().optional(),
          template: z.enum(EVIDENCE_TEMPLATES as [string, ...string[]]),
          format: z.enum(["pdf", "zip"]),
        })
        .refine((value) => value.orderKey || value.conversationId, {
          message: "An order or a conversation is required",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const template = input.template as (typeof EVIDENCE_TEMPLATES)[number];
      let conversationIds: string[];
      let order: {
        label: string;
        platform: string | null;
        total: string | null;
        placedAt: string | null;
      } | null = null;

      if (input.orderKey) {
        const group = await orderLinkService.conversationsForOrder(
          organizationId,
          input.orderKey,
          input.pluginId ?? null,
        );
        if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        conversationIds = group.conversationIds;
        const summary = await orderSummary(conversationIds, group);
        order = {
          label: `#${group.orderLabel ?? group.orderKey}`,
          platform: platformName(group.pluginId),
          ...summary,
        };
      } else {
        conversationIds = [input.conversationId!];
      }

      const result = await disputeEvidenceService.render({
        organizationId,
        conversationIds,
        template,
        order,
      });
      if (result.conversationIds.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No stored conversations found" });
      }

      const organization = await organizationRepository.findById(organizationId);
      const timeZone = safeTimeZone(organization?.timezone);
      const date = result.generatedAt.toISOString().slice(0, 10);
      const base = order
        ? `evidence-order-${fileSlug(order.label)}-${date}`
        : `evidence-conversation-${date}`;
      const buffer =
        input.format === "zip"
          ? await buildEvidenceZip(result, { timeZone, template, orderLabel: order?.label ?? null })
          : result.pdf;

      await auditLogService
        .log({
          userId: ctx.user?.id,
          organizationId,
          action: "dispute_evidence.export",
          resource: "conversation",
          metadata: {
            format: input.format,
            template,
            order: order?.label ?? null,
            pluginId: input.pluginId ?? null,
            conversationIds: result.conversationIds,
            bytes: buffer.length,
          },
        })
        .catch(() => undefined);

      return {
        base64Data: buffer.toString("base64"),
        fileName: `${base}.${input.format}`,
        mimeType: input.format === "zip" ? "application/zip" : "application/pdf",
        conversationCount: result.conversationIds.length,
        imagesOmitted: result.imagesOmitted,
        overCap: result.overCap,
      };
    }),
});
