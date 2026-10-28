import { AppDataSource } from "@server/database/data-source";
import { getDashboardUrl } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import {
  organizationNotificationLocale,
  type NotificationLocale,
} from "@server/services/notification-locale";
import { insightsService } from "./insights.service";
import { getOrganizationThresholds } from "./insight-settings";

const logger = createLogger("insight-digest");

const TOP_ITEMS = 5;

export interface DigestContent {
  newCount: number;
  recurringCount: number;
  positiveCount: number;
  fixed: number;
  measured: number;
  top: Array<{ id: string; title: string; size: number }>;
}

const COPY: Record<
  NotificationLocale,
  {
    subject: (count: number) => string;
    title: string;
    message: (count: number) => string;
    newLabel: string;
    recurringLabel: string;
    positiveLabel: string;
    fixedLabel: string;
    fixedValue: (fixed: number, measured: number) => string;
    item: (title: string, size: number) => string;
    untitled: string;
    button: string;
    footer: string;
  }
> = {
  en: {
    subject: (count) => `Insights this week: ${count} new`,
    title: "Your weekly Insights",
    message: (count) =>
      count > 0
        ? `Hay.chat found ${count} new patterns in your conversations this week. The ones with the most impact are below.`
        : "No new patterns this week. Here is where your open insights stand.",
    newLabel: "New",
    recurringLabel: "Came back after addressed",
    positiveLabel: "Working well",
    fixedLabel: "Fixed after addressed",
    fixedValue: (fixed, measured) => `${fixed} of ${measured}`,
    item: (title, size) => `${title} (${size} conversations)`,
    untitled: "Untitled pattern",
    button: "Open Insights",
    footer: "You get this weekly digest as an owner or admin. Turn it off in Insights settings.",
  },
  "pt-BR": {
    subject: (count) => `Insights da semana: ${count} novos`,
    title: "Seus Insights da semana",
    message: (count) =>
      count > 0
        ? `O Hay.chat encontrou ${count} novos padrões nas suas conversas esta semana. Os de maior impacto estão abaixo.`
        : "Nenhum padrão novo esta semana. Veja como estão os seus insights abertos.",
    newLabel: "Novos",
    recurringLabel: "Voltaram depois de resolvidos",
    positiveLabel: "Funcionando bem",
    fixedLabel: "Corrigidos depois de resolvidos",
    fixedValue: (fixed, measured) => `${fixed} de ${measured}`,
    item: (title, size) => `${title} (${size} conversas)`,
    untitled: "Padrão sem título",
    button: "Abrir Insights",
    footer:
      "Você recebe este resumo semanal como dono ou administrador. Desative nas configurações do Insights.",
  },
  es: {
    subject: (count) => `Insights de la semana: ${count} nuevos`,
    title: "Tus Insights de la semana",
    message: (count) =>
      count > 0
        ? `Hay.chat encontró ${count} patrones nuevos en tus conversaciones esta semana. Los de mayor impacto están abajo.`
        : "No hay patrones nuevos esta semana. Así están tus insights abiertos.",
    newLabel: "Nuevos",
    recurringLabel: "Volvieron después de resueltos",
    positiveLabel: "Funcionando bien",
    fixedLabel: "Corregidos después de resueltos",
    fixedValue: (fixed, measured) => `${fixed} de ${measured}`,
    item: (title, size) => `${title} (${size} conversaciones)`,
    untitled: "Patrón sin título",
    button: "Abrir Insights",
    footer:
      "Recibes este resumen semanal como dueño o administrador. Desactívalo en la configuración de Insights.",
  },
};

/**
 * Weekly Insights digest to owners and admins (Roger: weekly digest only, no
 * real-time alerts). One email per org per week, claimed in insight_org_state
 * before sending so a restart never sends it twice.
 */
export class InsightDigestService {
  /** Orgs with a promoted insight seen in the last 7 days. */
  async organizationsWithActivity(): Promise<string[]> {
    const rows: Array<{ organization_id: string }> = await AppDataSource.query(
      `SELECT DISTINCT organization_id FROM insight_clusters
        WHERE promoted_at IS NOT NULL AND merged_into_id IS NULL
          AND last_seen_at >= now() - interval '7 days'`,
    );
    return rows.map((r) => r.organization_id);
  }

  async runAll(): Promise<number> {
    let sent = 0;
    for (const organizationId of await this.organizationsWithActivity()) {
      try {
        if (await this.sendForOrganization(organizationId)) sent++;
      } catch (error) {
        logger.error({ err: error, organizationId }, "Weekly insights digest failed");
      }
    }
    return sent;
  }

  async buildContent(organizationId: string): Promise<DigestContent> {
    const [counts] = await AppDataSource.query(
      `SELECT count(*) FILTER (WHERE promoted_at >= now() - interval '7 days')::int AS new_count,
              count(*) FILTER (WHERE recurred_at >= now() - interval '7 days')::int AS recurring_count,
              count(*) FILTER (WHERE polarity = 'positive' AND state IN ('new', 'acknowledged', 'in_progress'))::int
                AS positive_count
         FROM insight_clusters
        WHERE organization_id = $1 AND promoted_at IS NOT NULL AND merged_into_id IS NULL`,
      [organizationId],
    );
    const list = await insightsService.list(organizationId, { days: 7, state: "open" });
    const top = [...list.items]
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, TOP_ITEMS)
      .map((item) => ({ id: item.id, title: item.title ?? "", size: item.periodSize }));
    return {
      newCount: Number(counts.new_count),
      recurringCount: Number(counts.recurring_count),
      positiveCount: Number(counts.positive_count),
      fixed: list.counts.fixed,
      measured: list.counts.measured,
      top,
    };
  }

  /** Returns true when the digest went out (to at least one recipient). */
  async sendForOrganization(organizationId: string): Promise<boolean> {
    const thresholds = await getOrganizationThresholds(organizationId);
    if (!thresholds.digestEnabled) return false;

    const recipients: Array<{ email: string; first_name: string | null }> =
      await AppDataSource.query(
        `SELECT u.email, u.first_name
           FROM user_organizations uo
           JOIN users u ON u.id = uo.user_id
          WHERE uo.organization_id = $1 AND uo.is_active = true AND u.is_active = true
            AND uo.role IN ('owner', 'admin')`,
        [organizationId],
      );
    if (recipients.length === 0) return false;

    const content = await this.buildContent(organizationId);
    if (content.top.length === 0 && content.newCount === 0 && content.recurringCount === 0) {
      return false;
    }

    // Claim the week first: at most one digest per org per ~week, even across restarts.
    const claimed = await AppDataSource.query(
      `INSERT INTO insight_org_state (organization_id, digest_last_sent_at)
       VALUES ($1, now())
       ON CONFLICT (organization_id) DO UPDATE SET digest_last_sent_at = now(), updated_at = now()
         WHERE insight_org_state.digest_last_sent_at IS NULL
            OR insight_org_state.digest_last_sent_at < now() - interval '6 days'
       RETURNING organization_id`,
      [organizationId],
    );
    if (claimed.length === 0) return false;

    const locale = await organizationNotificationLocale(organizationId);
    const copy = COPY[locale];
    const base = getDashboardUrl();
    const { emailService } = await import("@server/services/email.service");
    let delivered = 0;
    for (const recipient of recipients) {
      try {
        const result = await emailService.sendTemplateEmail({
          to: recipient.email,
          subject: copy.subject(content.newCount),
          template: "notification",
          locale,
          variables: {
            companyName: "Hay.chat",
            userName: recipient.first_name || undefined,
            notificationTitle: copy.title,
            notificationMessage: copy.message(content.newCount),
            details: [
              { label: copy.newLabel, value: String(content.newCount) },
              { label: copy.recurringLabel, value: String(content.recurringCount) },
              { label: copy.positiveLabel, value: String(content.positiveCount) },
              ...(content.measured > 0
                ? [
                    {
                      label: copy.fixedLabel,
                      value: copy.fixedValue(content.fixed, content.measured),
                    },
                  ]
                : []),
            ],
            relatedItems: content.top.map((item) => ({
              text: copy.item(item.title || copy.untitled, item.size),
              url: `${base}/insights/${item.id}`,
            })),
            actionButton: { url: `${base}/insights`, text: copy.button },
            additionalInfo: copy.footer,
          },
        });
        if (result.success) delivered++;
      } catch (error) {
        logger.warn({ err: error, organizationId }, "Digest email failed for one recipient");
      }
    }
    return delivered > 0;
  }
}

export const insightDigestService = new InsightDigestService();
