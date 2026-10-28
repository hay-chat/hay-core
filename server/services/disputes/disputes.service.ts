import { z } from "zod";
import { AppDataSource } from "@server/database/data-source";
import { Dispute, type DisputeStatus } from "@server/database/entities/dispute.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import { getDashboardUrl } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { formatZonedDateTime, safeTimeZone } from "@server/utils/zoned-datetime";
import { organizationNotificationLocale } from "../notification-locale";
import { orderLinkService, type OrderGroup } from "../order-links/order-link.service";
import { disputeEvidenceService } from "../dispute-evidence/dispute-evidence.service";
import { orderSummaryForGroup } from "../dispute-evidence/order-summary";
import { auditLogService } from "../audit-log.service";
import {
  ALERT_COPY,
  EVIDENCE_FILE_PREFIX,
  EVIDENCE_NOTE_MARKER,
  evidenceNote,
  templateForReason,
  type AlertFacts,
} from "./copy";

/**
 * Payment disputes (D2-7 / D2-8). Plugins with the `disputes` capability
 * report chargebacks here (`pluginApi.disputes.report`); core matches each to
 * an order in the order index, alerts owners and admins, reminds them before
 * the evidence deadline, and on one click renders the evidence pack and hands
 * it to the plugin's `/disputes/evidence` route, which attaches it to the
 * dispute as a DRAFT. Core never asks a plugin to submit; the merchant submits
 * on the payment platform.
 *
 * Plugin-agnostic: the source is whatever plugin reported the dispute.
 */

const logger = createLogger("disputes");

/** Remind when the deadline is this close and nothing is attached. */
export const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Cap for a pushed pack. The worker's JSON body limit is 5 MB and base64 adds
 * a third, so the PDF must stay under ~3.5 MB (Shopify's own cap is 4 MB).
 */
export const PUSH_PDF_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);

const PUSH_TIMEOUT_MS = 60_000;

export interface ReportedDispute {
  externalId: string;
  status: DisputeStatus;
  amount?: string;
  currency?: string;
  reason?: string;
  evidenceDueBy?: string;
  initiatedAt?: string;
  orderRefs?: string[];
  orderLabel?: string;
  providerUrl?: string;
}

export type AttachErrorCode =
  | "NOT_EDITABLE"
  | "SLOT_TAKEN"
  | "SCOPE_MISSING"
  | "NOT_FOUND"
  | "NOT_CONNECTED"
  | "PROVIDER_ERROR"
  | "NO_ORDER"
  | "NO_CONVERSATIONS"
  | "TOO_LARGE";

export type AttachResult =
  | { ok: true; providerUrl: string | null }
  | { ok: false; code: AttachErrorCode; message: string };

const workerResponseSchema = z.union([
  z.object({ ok: z.literal(true), providerUrl: z.string().optional() }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "NOT_EDITABLE",
      "SLOT_TAKEN",
      "SCOPE_MISSING",
      "NOT_FOUND",
      "NOT_CONNECTED",
      "PROVIDER_ERROR",
    ]),
    message: z.string(),
  }),
]);

const toDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const fileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "order";

interface Recipient {
  email: string;
  first_name: string | null;
}

/** Plugin display name; injectable for tests. */
type PlatformName = (pluginId: string | null) => string | null;
type WorkerPort = (organizationId: string, pluginId: string) => Promise<number>;

async function defaultPlatformName(pluginId: string | null): Promise<string | null> {
  if (!pluginId) return null;
  const { pluginManagerService } = await import("../plugin-manager.service");
  return pluginManagerService.getPlugin(pluginId)?.name ?? null;
}

async function defaultWorkerPort(organizationId: string, pluginId: string): Promise<number> {
  const { pluginManagerService } = await import("../plugin-manager.service");
  const worker = await pluginManagerService.getOrStartWorker(organizationId, pluginId);
  return worker.port;
}

export class DisputesService {
  constructor(
    private readonly deps: {
      platformName?: PlatformName;
      workerPort?: WorkerPort;
    } = {},
  ) {}

  private repo() {
    return AppDataSource.getRepository(Dispute);
  }

  private async platformName(pluginId: string | null): Promise<string | null> {
    if (this.deps.platformName) return this.deps.platformName(pluginId);
    return defaultPlatformName(pluginId);
  }

  /** Create or update a dispute from its plugin. Idempotent on (org, plugin, externalId). */
  async report(
    organizationId: string,
    pluginId: string,
    input: ReportedDispute,
  ): Promise<{ created: boolean; dispute: Dispute }> {
    const repo = this.repo();
    const existing = await repo.findOne({
      where: { organizationId, pluginId, externalId: input.externalId },
    });
    const orderRefs = [...new Set((input.orderRefs ?? []).map((r) => r.trim()).filter(Boolean))];
    const fields: Partial<Dispute> = {
      status: input.status,
      amount: input.amount ?? existing?.amount ?? null,
      currency: input.currency?.toUpperCase() ?? existing?.currency ?? null,
      reason: input.reason ?? existing?.reason ?? null,
      evidenceDueBy: toDate(input.evidenceDueBy) ?? existing?.evidenceDueBy ?? null,
      initiatedAt: toDate(input.initiatedAt) ?? existing?.initiatedAt ?? null,
      orderRefs: orderRefs.length ? orderRefs : (existing?.orderRefs ?? []),
      orderLabel: input.orderLabel ?? existing?.orderLabel ?? null,
      providerUrl: input.providerUrl ?? existing?.providerUrl ?? null,
    };

    // Match (or retry matching) until an order is found: the order index may
    // learn about the order after the dispute arrives.
    if (!existing?.orderKey) {
      const match = await this.matchOrder(organizationId, pluginId, fields.orderRefs ?? []);
      if (match) {
        fields.orderKey = match.orderKey;
        fields.orderPluginId = match.pluginId;
        if (!fields.orderLabel && match.orderLabel) fields.orderLabel = `#${match.orderLabel}`;
      }
    }

    let dispute: Dispute;
    let created = false;
    if (existing) {
      await repo.update({ id: existing.id }, fields);
      dispute = { ...existing, ...fields } as Dispute;
    } else {
      // ON CONFLICT DO NOTHING: two webhook deliveries can race.
      const inserted = await repo
        .createQueryBuilder()
        .insert()
        .into(Dispute)
        .values({ organizationId, pluginId, externalId: input.externalId, ...fields })
        .orIgnore()
        .returning("*")
        .execute();
      created = inserted.raw.length > 0;
      dispute = (await repo.findOneOrFail({
        where: { organizationId, pluginId, externalId: input.externalId },
      })) as Dispute;
    }

    if (dispute.status === "needs_response" && !dispute.alertedAt) {
      await this.alert(dispute, "opened");
    }
    return { created, dispute };
  }

  /** First order ref the order index knows; the reporting plugin's own orders win ties. */
  async matchOrder(
    organizationId: string,
    pluginId: string,
    refs: string[],
  ): Promise<OrderGroup | null> {
    for (const ref of refs) {
      const groups = await orderLinkService.findOrders(organizationId, { query: ref });
      if (groups.length === 0) continue;
      return (
        groups.find((g) => g.pluginId === pluginId) ?? groups.find((g) => g.pluginId) ?? groups[0]
      );
    }
    return null;
  }

  async list(organizationId: string): Promise<Dispute[]> {
    return this.repo()
      .createQueryBuilder("d")
      .where("d.organization_id = :organizationId", { organizationId })
      .orderBy("CASE WHEN d.status = 'needs_response' THEN 0 ELSE 1 END", "ASC")
      .addOrderBy("d.evidence_due_by", "ASC", "NULLS LAST")
      .addOrderBy("d.created_at", "DESC")
      .limit(100)
      .getMany();
  }

  /**
   * Owners and admins: "opened" once per dispute, "reminder" once when the
   * deadline is near. Claimed with a conditional UPDATE so concurrent reports
   * or job runs alert once. Best effort: failures are logged, never thrown.
   */
  async alert(dispute: Dispute, kind: "opened" | "reminder"): Promise<boolean> {
    const column = kind === "opened" ? "alerted_at" : "reminded_at";
    const claimed = await AppDataSource.query(
      `UPDATE disputes SET ${column} = now() WHERE id = $1 AND ${column} IS NULL RETURNING id`,
      [dispute.id],
    );
    const rows = Array.isArray(claimed[0]) ? claimed[0] : claimed;
    if (!rows.length) return false;

    try {
      const { organizationId } = dispute;
      const [locale, organization, platform] = await Promise.all([
        organizationNotificationLocale(organizationId),
        organizationRepository.findById(organizationId),
        this.platformName(dispute.pluginId),
      ]);
      const copy = ALERT_COPY[locale];
      const facts: AlertFacts = {
        order: dispute.orderLabel,
        platform: platform ?? dispute.pluginId,
        amount: dispute.amount
          ? `${dispute.amount}${dispute.currency ? ` ${dispute.currency}` : ""}`
          : null,
        reason: dispute.reason,
        dueBy: dispute.evidenceDueBy
          ? formatZonedDateTime(dispute.evidenceDueBy, safeTimeZone(organization?.timezone))
          : null,
      };
      const path = `/evidence?dispute=${dispute.id}&org=${organizationId}`;
      const title = kind === "opened" ? copy.title : copy.reminderTitle;
      const subject = kind === "opened" ? copy.subject(facts) : copy.reminderSubject(facts);
      const message = kind === "opened" ? copy.message(facts) : copy.reminderMessage(facts);
      const details = (
        [
          [copy.labels.order, facts.order],
          [copy.labels.platform, facts.platform],
          [copy.labels.amount, facts.amount],
          [copy.labels.reason, facts.reason],
          [copy.labels.dueBy, facts.dueBy],
        ] as Array<[string, string | null]>
      )
        .filter(([, value]) => value)
        .map(([label, value]) => ({ label, value: value as string }));

      const { emailService } = await import("../email.service");
      const recipients: Recipient[] = await AppDataSource.query(
        `SELECT u.email, u.first_name
           FROM user_organizations uo
           JOIN users u ON u.id = uo.user_id
          WHERE uo.organization_id = $1
            AND uo.is_active = true
            AND uo.role IN ('owner', 'admin')
            AND u.is_active = true`,
        [organizationId],
      );
      await Promise.all(
        recipients.map((recipient) =>
          emailService
            .sendTemplateEmail({
              to: recipient.email,
              subject,
              template: "notification",
              locale,
              variables: {
                companyName: "Hay.chat",
                userName: recipient.first_name || undefined,
                notificationTitle: title,
                notificationMessage: message,
                details,
                actionButton: { url: `${getDashboardUrl()}${path}`, text: copy.button },
                additionalInfo: copy.footer,
              },
            })
            .catch((error: unknown) => {
              logger.error({ err: error, organizationId }, "Dispute alert email failed");
            }),
        ),
      );

      const { pushNotificationService } = await import("../push-notification.service");
      await pushNotificationService.onDisputeOpened({
        organizationId,
        title,
        body: message,
        url: path,
        tag: `dispute:${dispute.id}`,
      });
    } catch (error) {
      logger.error({ err: error, disputeId: dispute.id }, "Dispute alert failed");
    }
    return true;
  }

  /** Scheduled: remind once for disputes due within the window with nothing attached. */
  async sendReminders(now: Date = new Date()): Promise<number> {
    const due = await this.repo()
      .createQueryBuilder("d")
      .where("d.status = 'needs_response'")
      .andWhere("d.evidence_status <> 'drafted'")
      .andWhere("d.reminded_at IS NULL")
      .andWhere("d.evidence_due_by > :now", { now })
      .andWhere("d.evidence_due_by <= :until", {
        until: new Date(now.getTime() + REMINDER_WINDOW_MS),
      })
      .limit(200)
      .getMany();
    let sent = 0;
    for (const dispute of due) {
      if (await this.alert(dispute, "reminder")) sent += 1;
    }
    return sent;
  }

  /**
   * "Attach as draft": render the matched order's evidence pack and hand it to
   * the reporting plugin, which attaches it to the dispute without submitting.
   */
  async attachEvidence(
    organizationId: string,
    disputeId: string,
    userId: string | null,
  ): Promise<AttachResult> {
    const dispute = await this.repo().findOne({ where: { id: disputeId, organizationId } });
    if (!dispute) return { ok: false, code: "NOT_FOUND", message: "Dispute not found" };
    if (dispute.status !== "needs_response") {
      return { ok: false, code: "NOT_EDITABLE", message: "This dispute no longer takes evidence" };
    }

    // Retry the match: conversations may have named the order since intake.
    if (!dispute.orderKey) {
      const match = await this.matchOrder(organizationId, dispute.pluginId, dispute.orderRefs);
      if (match) {
        dispute.orderKey = match.orderKey;
        dispute.orderPluginId = match.pluginId;
        await this.repo().update(
          { id: dispute.id },
          { orderKey: match.orderKey, orderPluginId: match.pluginId },
        );
      }
    }
    if (!dispute.orderKey) {
      return { ok: false, code: "NO_ORDER", message: "No conversation mentions this order" };
    }
    const group = await orderLinkService.conversationsForOrder(
      organizationId,
      dispute.orderKey,
      dispute.orderPluginId,
    );
    if (!group || group.conversationIds.length === 0) {
      return { ok: false, code: "NO_CONVERSATIONS", message: "No stored conversations found" };
    }

    const summary = await orderSummaryForGroup(group.conversationIds, group);
    const orderLabel = dispute.orderLabel ?? `#${group.orderLabel ?? group.orderKey}`;
    const pack = await disputeEvidenceService.render({
      organizationId,
      conversationIds: group.conversationIds,
      template: templateForReason(dispute.reason),
      order: {
        label: orderLabel,
        platform: await this.platformName(group.pluginId),
        total:
          summary.total ??
          (dispute.amount
            ? `${dispute.amount}${dispute.currency ? ` ${dispute.currency}` : ""}`
            : null),
        placedAt: summary.placedAt,
      },
      maxBytes: PUSH_PDF_MAX_BYTES,
    });
    if (pack.conversationIds.length === 0) {
      return { ok: false, code: "NO_CONVERSATIONS", message: "No stored conversations found" };
    }
    if (pack.overCap) {
      return {
        ok: false,
        code: "TOO_LARGE",
        message: "The evidence file is too large to attach; download it from this page instead",
      };
    }

    const date = pack.generatedAt.toISOString().slice(0, 10);
    const fileName = `${EVIDENCE_FILE_PREFIX}-${fileSlug(orderLabel)}-${date}.pdf`;
    const text = evidenceNote({
      locale: pack.locale,
      fileName,
      orderLabel,
      conversationCount: pack.conversationIds.length,
      generatedAt: date,
    });

    let result: AttachResult;
    try {
      result = await this.pushToPlugin(organizationId, dispute, {
        disputeId: dispute.externalId,
        file: { name: fileName, mimeType: "application/pdf", base64: pack.pdf.toString("base64") },
        text,
        marker: EVIDENCE_NOTE_MARKER,
      });
    } catch (error) {
      logger.error({ err: error, disputeId }, "Dispute evidence push failed");
      result = { ok: false, code: "PROVIDER_ERROR", message: "The platform could not be reached" };
    }

    // Explicit cast: ts-jest compiles without strictNullChecks, where `ok` does not narrow.
    const failure = result.ok ? null : (result as Extract<AttachResult, { ok: false }>);
    const providerUrl = result.ok
      ? ((result as Extract<AttachResult, { ok: true }>).providerUrl ?? dispute.providerUrl)
      : null;
    await this.repo().update(
      { id: dispute.id },
      !failure
        ? {
            evidenceStatus: "drafted",
            evidencePushedAt: new Date(),
            evidencePushedBy: userId,
            evidenceError: null,
            providerUrl,
          }
        : { evidenceStatus: "failed", evidenceError: failure.code },
    );

    await auditLogService
      .log({
        userId: userId ?? undefined,
        organizationId,
        action: "dispute_evidence.push",
        resource: "dispute",
        metadata: {
          disputeId: dispute.id,
          pluginId: dispute.pluginId,
          externalId: dispute.externalId,
          order: orderLabel,
          conversationIds: pack.conversationIds,
          bytes: pack.pdf.length,
          ok: result.ok,
          code: failure?.code ?? null,
          submitted: false,
        },
      })
      .catch(() => undefined);

    return failure ?? { ok: true, providerUrl };
  }

  private async pushToPlugin(
    organizationId: string,
    dispute: Dispute,
    body: {
      disputeId: string;
      file: { name: string; mimeType: string; base64: string };
      text: string;
      marker: string;
    },
  ): Promise<AttachResult> {
    const port = await (this.deps.workerPort ?? defaultWorkerPort)(
      organizationId,
      dispute.pluginId,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const response = await fetch(`http://localhost:${port}/disputes/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 404) {
        return { ok: false, code: "NOT_CONNECTED", message: "This plugin cannot attach evidence" };
      }
      const parsed = workerResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        logger.warn(
          { pluginId: dispute.pluginId, status: response.status },
          "Invalid evidence reply",
        );
        return { ok: false, code: "PROVIDER_ERROR", message: "The plugin gave an invalid answer" };
      }
      return parsed.data.ok
        ? { ok: true, providerUrl: parsed.data.providerUrl ?? null }
        : parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const disputesService = new DisputesService();
