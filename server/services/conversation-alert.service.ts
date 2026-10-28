import { QueryFailedError } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { getDashboardUrl } from "@server/config/env";
import {
  Conversation,
  type ConversationStatus,
} from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import {
  NotificationDelivery,
  type NotificationChannel,
  type NotificationStatus,
  type NotificationStep,
} from "@server/database/entities/notification-delivery.entity";
import { createLogger } from "@server/lib/logger";
import { pushNotificationService, type PushPayload } from "./push-notification.service";
import { isWithinBusinessHours } from "./business-hours.service";
import { organizationNotificationLocale, type NotificationLocale } from "./notification-locale";

const logger = createLogger("conversation-alerts");

/**
 * Alerts for conversations that need a human (D11-8).
 *
 * Ladder per hand-off ("cycle", starting when the conversation enters
 * pending-human):
 *  1. initial push to every Available member's devices, at once;
 *  2. after ESCALATION_DELAY_MS unanswered, within business hours: re-push;
 *  3. ESCALATION_DELAY_MS after that (or right away when the re-push reached
 *     no device): email the Available members.
 * The ladder stops as soon as a human replies, takes over or is assigned, or
 * the conversation leaves pending-human (closed, back to the AI).
 *
 * Every step is recorded per recipient in `notification_deliveries`; the row
 * is inserted (claimed) before sending, so a step never goes out twice.
 */

export const ESCALATION_DELAY_MS = 10 * 60 * 1000;
/** Cycles older than this are left alone (covers a long weekend outside hours). */
const MAX_CYCLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type EscalationStep = "repush" | "email";

export interface EscalationState {
  status: ConversationStatus;
  assignedUserId: string | null;
  cycleStartedAt: Date;
  /** A HumanAgent message was saved since the cycle started. */
  humanReplied: boolean;
  withinBusinessHours: boolean;
  /** When the re-push step was claimed, or null if not yet. */
  repushAt: Date | null;
  /** The re-push reached at least one device. */
  repushDelivered: boolean;
  emailed: boolean;
  now: Date;
}

/** The ladder's decision for one conversation; null = nothing to do now. */
export function nextEscalationStep(state: EscalationState): EscalationStep | null {
  if (state.status !== "pending-human") return null;
  if (state.assignedUserId || state.humanReplied) return null;
  if (!state.withinBusinessHours) return null;
  if (state.emailed) return null;

  const now = state.now.getTime();
  if (!state.repushAt) {
    return now - state.cycleStartedAt.getTime() >= ESCALATION_DELAY_MS ? "repush" : null;
  }
  if (!state.repushDelivered) return "email";
  return now - state.repushAt.getTime() >= ESCALATION_DELAY_MS ? "email" : null;
}

export interface MemberCandidate {
  id: string;
  email: string;
  firstName: string | null;
  membershipActive: boolean;
  userActive: boolean;
  status: string;
}

/** Alerts go only to active members of the organization who are set to Available. */
export function isAlertRecipient(member: MemberCandidate): boolean {
  return member.membershipActive && member.userActive && member.status === "available";
}

const COPY: Record<
  NotificationLocale,
  {
    pushTitle: string;
    repushTitle: string;
    untitled: string;
    summaryPending: string;
    emailSubject: (who: string) => string;
    emailTitle: string;
    emailMessage: (who: string, minutes: number) => string;
    summaryLabel: string;
    emailButton: string;
    emailFooter: string;
  }
> = {
  en: {
    pushTitle: "A customer needs a human",
    repushTitle: "A customer is still waiting for a human",
    untitled: "New conversation",
    summaryPending: "Tap to open the conversation and take over.",
    emailSubject: (who) => `${who} is still waiting for a reply`,
    emailTitle: "A customer is still waiting",
    emailMessage: (who, minutes) =>
      `${who} asked for a person ${minutes} minutes ago and nobody on your team has answered yet.`,
    summaryLabel: "Summary",
    emailButton: "Open the conversation",
    emailFooter:
      "You get this email because you are set to Available in Hay.chat. Set yourself to Away to stop these alerts.",
  },
  "pt-BR": {
    pushTitle: "Um cliente precisa de um humano",
    repushTitle: "Um cliente ainda está esperando um humano",
    untitled: "Nova conversa",
    summaryPending: "Toque para abrir a conversa e assumir.",
    emailSubject: (who) => `${who} ainda está esperando uma resposta`,
    emailTitle: "Um cliente ainda está esperando",
    emailMessage: (who, minutes) =>
      `${who} pediu para falar com uma pessoa há ${minutes} minutos e ninguém da sua equipe respondeu ainda.`,
    summaryLabel: "Resumo",
    emailButton: "Abrir a conversa",
    emailFooter:
      "Você recebe este e-mail porque está como Disponível no Hay.chat. Mude para Ausente para parar estes alertas.",
  },
  es: {
    pushTitle: "Un cliente necesita a una persona",
    repushTitle: "Un cliente sigue esperando a una persona",
    untitled: "Nueva conversación",
    summaryPending: "Toca para abrir la conversación y atenderla.",
    emailSubject: (who) => `${who} sigue esperando una respuesta`,
    emailTitle: "Un cliente sigue esperando",
    emailMessage: (who, minutes) =>
      `${who} pidió hablar con una persona hace ${minutes} minutos y nadie de tu equipo ha respondido todavía.`,
    summaryLabel: "Resumen",
    emailButton: "Abrir la conversación",
    emailFooter:
      "Recibes este correo porque estás como Disponible en Hay.chat. Cambia a Ausente para dejar de recibir estas alertas.",
  },
};

function conversationPath(conversation: Pick<Conversation, "id" | "organization_id">): string {
  // `org` lets the dashboard switch to the right organization for multi-org users
  return `/conversations/${conversation.id}?org=${conversation.organization_id}`;
}

function customerLabel(conversation: Conversation, locale: NotificationLocale): string {
  return conversation.customer?.name || conversation.title || COPY[locale].untitled;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === "23505"
  );
}

class ConversationAlertService {
  private deliveries() {
    return AppDataSource.getRepository(NotificationDelivery);
  }

  /** Active, Available members of the organization (with their email). */
  async findRecipients(organizationId: string): Promise<MemberCandidate[]> {
    const rows: Array<{
      id: string;
      email: string;
      first_name: string | null;
      membership_active: boolean;
      user_active: boolean;
      status: string;
    }> = await AppDataSource.query(
      `SELECT u.id, u.email, u.first_name, uo.is_active AS membership_active,
              u.is_active AS user_active, u.status
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
        WHERE uo.organization_id = $1
          AND uo.is_active = true
          AND u.is_active = true
          AND u.status = 'available'`,
      [organizationId],
    );
    return rows
      .map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        membershipActive: row.membership_active,
        userActive: row.user_active,
        status: row.status,
      }))
      .filter(isAlertRecipient);
  }

  /** Called by the conversation repository on every status transition. */
  async onConversationStatusChanged(conversation: Conversation): Promise<void> {
    if (conversation.status !== "pending-human") return;
    await this.pushStep(conversation, new Date(), "initial");
  }

  /**
   * Claim the step for one recipient. Returns the row, or null when this step
   * was already claimed (another sweep, or a retry).
   */
  private async claim(
    conversation: Conversation,
    cycleStartedAt: Date,
    step: NotificationStep,
    channel: NotificationChannel,
    userId: string,
  ): Promise<NotificationDelivery | null> {
    try {
      return await this.deliveries().save(
        this.deliveries().create({
          organization_id: conversation.organization_id,
          conversation_id: conversation.id,
          user_id: userId,
          cycle_started_at: cycleStartedAt,
          step,
          channel,
          status: "pending",
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  private async finish(
    row: NotificationDelivery,
    status: NotificationStatus,
    detail: string | null,
  ): Promise<void> {
    await this.deliveries().update(
      { id: row.id },
      { status, detail, sent_at: status === "sent" ? new Date() : null },
    );
  }

  /** Initial push or re-push to every recipient's devices. Recorded even with push off. */
  private async pushStep(
    conversation: Conversation,
    cycleStartedAt: Date,
    step: "initial" | "repush",
  ): Promise<void> {
    const recipients = await this.findRecipients(conversation.organization_id);
    if (recipients.length === 0) {
      logger.info(
        { conversationId: conversation.id, step },
        "No Available member to alert for a conversation waiting for a human",
      );
      return;
    }

    const locale = await organizationNotificationLocale(conversation.organization_id);
    const copy = COPY[locale];
    const who = customerLabel(conversation, locale);
    const payload: PushPayload = {
      kind: "conversation_needs_attention",
      title: step === "initial" ? copy.pushTitle : copy.repushTitle,
      body: conversation.summary
        ? `${who}: ${conversation.summary}`
        : `${who}. ${copy.summaryPending}`,
      url: conversationPath(conversation),
      tag: `conversation:${conversation.id}`,
    };

    await Promise.all(
      recipients.map(async (recipient) => {
        const row = await this.claim(conversation, cycleStartedAt, step, "push", recipient.id);
        if (!row) return;
        try {
          const result = await pushNotificationService.sendToUser(recipient.id, payload);
          const status: NotificationStatus =
            result.sent > 0 ? "sent" : result.devices - result.removed > 0 ? "failed" : "no_device";
          await this.finish(row, status, `devices=${result.devices} sent=${result.sent}`);
        } catch (error) {
          await this.finish(row, "failed", error instanceof Error ? error.message : String(error));
        }
      }),
    );
  }

  private async emailStep(
    conversation: Conversation,
    cycleStartedAt: Date,
    now: Date,
  ): Promise<void> {
    const recipients = await this.findRecipients(conversation.organization_id);
    if (recipients.length === 0) return;

    const { emailService } = await import("./email.service");
    const locale = await organizationNotificationLocale(conversation.organization_id);
    const copy = COPY[locale];
    const who = customerLabel(conversation, locale);
    const minutes = Math.max(1, Math.round((now.getTime() - cycleStartedAt.getTime()) / 60000));
    const url = `${getDashboardUrl()}${conversationPath(conversation)}`;

    await Promise.all(
      recipients.map(async (recipient) => {
        const row = await this.claim(conversation, cycleStartedAt, "email", "email", recipient.id);
        if (!row) return;
        try {
          const result = await emailService.sendTemplateEmail({
            to: recipient.email,
            subject: copy.emailSubject(who),
            template: "notification",
            locale,
            variables: {
              companyName: "Hay.chat",
              userName: recipient.firstName || undefined,
              notificationTitle: copy.emailTitle,
              notificationMessage: copy.emailMessage(who, minutes),
              details: conversation.summary
                ? [{ label: copy.summaryLabel, value: conversation.summary }]
                : undefined,
              actionButton: { url, text: copy.emailButton },
              additionalInfo: copy.emailFooter,
            },
          });
          await this.finish(row, result.success ? "sent" : "failed", result.error ?? null);
        } catch (error) {
          await this.finish(row, "failed", error instanceof Error ? error.message : String(error));
        }
      }),
    );
  }

  /**
   * Scheduled sweep: advance the ladder of every conversation whose current
   * cycle is still waiting for a human.
   */
  async runEscalationSweep(now: Date = new Date()): Promise<void> {
    const cycles: Array<{ conversation_id: string; cycle_started_at: Date }> =
      await AppDataSource.query(
        `SELECT d.conversation_id, MAX(d.cycle_started_at) AS cycle_started_at
           FROM notification_deliveries d
           JOIN conversations c ON c.id = d.conversation_id
          WHERE d.step = 'initial'
            AND d.cycle_started_at > $1
            AND c.status = 'pending-human'
            AND c.assigned_user_id IS NULL
            AND c.deleted_at IS NULL
          GROUP BY d.conversation_id`,
        [new Date(now.getTime() - MAX_CYCLE_AGE_MS)],
      );

    for (const cycle of cycles) {
      try {
        await this.escalate(cycle.conversation_id, new Date(cycle.cycle_started_at), now);
      } catch (error) {
        logger.error(
          { err: error, conversationId: cycle.conversation_id },
          "Alert escalation failed",
        );
      }
    }
  }

  private async escalate(conversationId: string, cycleStartedAt: Date, now: Date): Promise<void> {
    const conversation = await AppDataSource.getRepository(Conversation).findOne({
      where: { id: conversationId },
      relations: ["customer"],
    });
    if (!conversation) return;

    const steps = await this.deliveries().find({
      where: { conversation_id: conversationId, cycle_started_at: cycleStartedAt },
    });
    const repushRows = steps.filter((row) => row.step === "repush");
    const humanReplies = await AppDataSource.getRepository(Message)
      .createQueryBuilder("m")
      .where("m.conversation_id = :conversationId", { conversationId })
      .andWhere("m.type = :type", { type: MessageType.HUMAN_AGENT })
      .andWhere("m.created_at >= :cycleStartedAt", { cycleStartedAt })
      .getCount();

    const step = nextEscalationStep({
      status: conversation.status,
      assignedUserId: conversation.assigned_user_id,
      cycleStartedAt,
      humanReplied: humanReplies > 0,
      withinBusinessHours: await isWithinBusinessHours(conversation.organization_id, now),
      repushAt: repushRows.length
        ? new Date(Math.min(...repushRows.map((row) => row.created_at.getTime())))
        : null,
      repushDelivered: repushRows.some((row) => row.status === "sent"),
      emailed: steps.some((row) => row.step === "email"),
      now,
    });

    if (step === "repush") await this.pushStep(conversation, cycleStartedAt, "repush");
    if (step === "email") await this.emailStep(conversation, cycleStartedAt, now);
  }
}

export const conversationAlertService = new ConversationAlertService();
