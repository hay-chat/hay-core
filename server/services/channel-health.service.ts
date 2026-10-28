import { AppDataSource } from "@server/database/data-source";
import type { ChannelHealth, ChannelHealthReason } from "@server/entities/plugin-instance.entity";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { getDashboardUrl } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { organizationNotificationLocale, type NotificationLocale } from "./notification-locale";

/**
 * Channel health (D13-11): one generic "channel failing" signal per channel
 * plugin instance, stored on `plugin_instances.channel_health`.
 *
 * Sources, all plugin-agnostic:
 *   - repeated failed deliveries: FAILURE_THRESHOLD replies on the channel
 *     ended `providerStatus: failed` within FAILURE_WINDOW (core delivery,
 *     plugin status webhooks, email bounces),
 *   - a revoked connection (`connection.revoke`),
 *   - the plugin's own report (`channel.reportHealth`, e.g. a WhatsApp
 *     number's quality rating dropping).
 *
 * Turning failing alerts every active owner and admin: an email and a push.
 * Repeat alerts for the same instance wait ALERT_COOLDOWN. A successful
 * delivery clears delivery/revocation failures; a reconnect clears all; a
 * plugin clears its own report with status "ok".
 */

const logger = createLogger("channel-health");

export const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Failures that say nothing about the channel itself. */
const IGNORED_FAILURE_CODES = ["24h_window_expired", "empty_message"];

/** Reasons a successful delivery proves resolved. */
const CLEARED_BY_DELIVERY: ChannelHealthReason[] = ["delivery_failures", "token_revoked"];

type Copy = {
  subject: (channel: string) => string;
  title: (channel: string) => string;
  reasons: Record<ChannelHealthReason, (detail: string) => string>;
  detailLabel: string;
  button: string;
  footer: string;
};

const COPY: Record<NotificationLocale, Copy> = {
  en: {
    subject: (channel) => `${channel} is failing on Hay.chat`,
    title: (channel) => `${channel} needs attention`,
    reasons: {
      delivery_failures: () =>
        "Several replies to customers could not be delivered in the last hour. Customers on this channel may not be getting answers.",
      token_revoked: () =>
        "The connection was revoked or expired. Hay.chat cannot receive or send messages on this channel until you reconnect it.",
      quality_drop: () =>
        "The provider lowered this channel's quality rating. Messaging limits may drop if it keeps falling.",
    },
    detailLabel: "Detail",
    button: "Open channel settings",
    footer: "Sent to every owner and admin of this organization.",
  },
  "pt-BR": {
    subject: (channel) => `${channel} está com falhas no Hay.chat`,
    title: (channel) => `${channel} precisa de atenção`,
    reasons: {
      delivery_failures: () =>
        "Várias respostas a clientes não puderam ser entregues na última hora. Clientes neste canal podem estar sem resposta.",
      token_revoked: () =>
        "A conexão foi revogada ou expirou. O Hay.chat não consegue receber nem enviar mensagens neste canal até você reconectá-lo.",
      quality_drop: () =>
        "O provedor reduziu a classificação de qualidade deste canal. Os limites de mensagens podem cair se ela continuar baixando.",
    },
    detailLabel: "Detalhe",
    button: "Abrir configurações do canal",
    footer: "Enviado a todos os proprietários e administradores desta organização.",
  },
  es: {
    subject: (channel) => `${channel} está fallando en Hay.chat`,
    title: (channel) => `${channel} necesita atención`,
    reasons: {
      delivery_failures: () =>
        "Varias respuestas a clientes no se pudieron entregar en la última hora. Los clientes de este canal pueden estar sin respuesta.",
      token_revoked: () =>
        "La conexión fue revocada o expiró. Hay.chat no puede recibir ni enviar mensajes en este canal hasta que lo vuelvas a conectar.",
      quality_drop: () =>
        "El proveedor bajó la calificación de calidad de este canal. Los límites de mensajes pueden bajar si sigue cayendo.",
    },
    detailLabel: "Detalle",
    button: "Abrir la configuración del canal",
    footer: "Enviado a todos los propietarios y administradores de esta organización.",
  },
};

interface Recipient {
  id: string;
  email: string;
  first_name: string | null;
}

async function adminRecipients(organizationId: string): Promise<Recipient[]> {
  return AppDataSource.query(
    `SELECT u.id, u.email, u.first_name
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.organization_id = $1
        AND uo.is_active = true
        AND uo.role IN ('owner', 'admin')
        AND u.is_active = true`,
    [organizationId],
  );
}

export const channelHealthService = {
  async get(organizationId: string, pluginId: string): Promise<ChannelHealth | null> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    return instance?.channelHealth ?? null;
  },

  /** A reply on `channel` ended failed: mark the channel failing past the threshold. */
  async recordDeliveryFailure(organizationId: string, channel: string): Promise<void> {
    try {
      const [{ count }]: Array<{ count: string }> = await AppDataSource.query(
        `SELECT COUNT(*)::int AS count
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.organization_id = $1
            AND c.channel = $2
            AND m.provider_status = 'failed'
            AND m.updated_at > $3
            AND COALESCE(m.provider_error->>'code', '') <> ALL($4)`,
        [organizationId, channel, new Date(Date.now() - FAILURE_WINDOW_MS), IGNORED_FAILURE_CODES],
      );
      const failures = Number(count);
      if (failures < FAILURE_THRESHOLD) return;
      const { pluginManagerService } = await import("./plugin-manager.service");
      const pluginId = await pluginManagerService.findPluginIdByChannel(organizationId, channel);
      if (!pluginId) return;
      await this.markFailing(organizationId, pluginId, "delivery_failures", `${failures}`);
    } catch (error) {
      logger.error({ err: error, organizationId, channel }, "Channel failure check failed");
    }
  },

  /** A reply was delivered: delivery and revocation failures are over. */
  async recordDeliverySuccess(organizationId: string, pluginId: string): Promise<void> {
    try {
      await this.markOk(organizationId, pluginId, CLEARED_BY_DELIVERY);
    } catch (error) {
      logger.error({ err: error, organizationId, pluginId }, "Channel health clear failed");
    }
  },

  async markFailing(
    organizationId: string,
    pluginId: string,
    reason: ChannelHealthReason,
    detail?: string,
  ): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    if (!instance) return;
    const previous = instance.channelHealth ?? null;
    const now = new Date();
    const sameFailure = previous?.status === "failing" && previous.reason === reason;
    const recentlyAlerted =
      !!previous?.lastAlertAt &&
      now.getTime() - new Date(previous.lastAlertAt).getTime() < ALERT_COOLDOWN_MS;
    const alert = !recentlyAlerted;

    const next: ChannelHealth = {
      status: "failing",
      reason,
      detail: detail?.slice(0, 200),
      since: sameFailure ? previous.since : now.toISOString(),
      lastAlertAt: alert ? now.toISOString() : previous?.lastAlertAt,
    };
    await pluginInstanceRepository.updateChannelHealth(instance.id, next);
    logger.warn({ organizationId, pluginId, reason, detail, alert }, "Channel marked failing");

    if (alert) {
      await this.alertAdmins(organizationId, pluginId, instance.plugin?.name ?? pluginId, next);
    }
  },

  /** Back to ok, optionally only when failing for one of `reasons`. */
  async markOk(
    organizationId: string,
    pluginId: string,
    reasons?: ChannelHealthReason[],
  ): Promise<void> {
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
    const previous = instance?.channelHealth;
    if (!instance || previous?.status !== "failing") return;
    if (reasons && (!previous.reason || !reasons.includes(previous.reason))) return;
    const next: ChannelHealth = {
      status: "ok",
      since: new Date().toISOString(),
      lastAlertAt: previous.lastAlertAt,
    };
    await pluginInstanceRepository.updateChannelHealth(instance.id, next);
    logger.info({ organizationId, pluginId, reason: previous.reason }, "Channel healthy again");
  },

  /** Email + push to every active owner and admin. Best effort. */
  async alertAdmins(
    organizationId: string,
    pluginId: string,
    channelName: string,
    health: ChannelHealth,
  ): Promise<void> {
    const locale = await organizationNotificationLocale(organizationId);
    const copy = COPY[locale];
    const reason = health.reason ?? "delivery_failures";
    const path = `/integrations/plugins/${encodeURIComponent(pluginId)}?org=${organizationId}`;
    const message = copy.reasons[reason](health.detail ?? "");

    try {
      const { emailService } = await import("./email.service");
      const recipients = await adminRecipients(organizationId);
      await Promise.all(
        recipients.map((recipient) =>
          emailService
            .sendTemplateEmail({
              to: recipient.email,
              subject: copy.subject(channelName),
              template: "notification",
              locale,
              variables: {
                companyName: "Hay.chat",
                userName: recipient.first_name || undefined,
                notificationTitle: copy.title(channelName),
                notificationMessage: message,
                details:
                  health.detail && reason !== "delivery_failures"
                    ? [{ label: copy.detailLabel, value: health.detail }]
                    : undefined,
                actionButton: { url: `${getDashboardUrl()}${path}`, text: copy.button },
                additionalInfo: copy.footer,
              },
            })
            .catch((error: unknown) => {
              logger.error({ err: error, organizationId }, "Channel failing email failed");
            }),
        ),
      );
    } catch (error) {
      logger.error({ err: error, organizationId }, "Channel failing emails failed");
    }

    try {
      const { pushNotificationService } = await import("./push-notification.service");
      await pushNotificationService.onChannelFailing({
        organizationId,
        title: copy.title(channelName),
        body: message,
        url: path,
        tag: `channel-failing:${pluginId}`,
      });
    } catch (error) {
      logger.error({ err: error, organizationId }, "Channel failing push failed");
    }
  },
};
