import { In, MoreThan } from "typeorm";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import {
  TeamQuestion,
  ANSWERABLE_TEAM_QUESTION_STATUSES,
  type TeamAnswerRelayMode,
} from "@server/database/entities/team-question.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { createLogger } from "@server/lib/logger";
import { resolveQuickCheckSettings } from "@server/types/organization-settings.types";
import { CLOSED_STATUSES, isTestConversation } from "../close-classification/outcome-rules";
import { aiRepliesHeldForReview } from "../ai-reply-review";
import { getAvailability } from "../business-hours.service";
import {
  maskEmail,
  quickCheckCopy,
  quickCheckOfflineLine,
} from "@server/orchestrator/handoff-copy";
import { recheckAiReply } from "@server/orchestrator/reply-guard";
import {
  decideQuickCheck,
  dueTimerStep,
  gaveUpVariant,
  minutesLeftAfterUpdate,
  type QuickCheckRefusal,
} from "./quick-check-rules";

const logger = createLogger("team-questions");

/** Longest question / answer we store (they are short facts). */
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ANSWER_LENGTH = 2000;
/** Open questions the 1-minute sweep handles per run. */
const SWEEP_BATCH = 200;

export type AskResult =
  /** The team was asked; the shopper gets the T0 line and the AI keeps answering. */
  | { kind: "asked"; question: TeamQuestion; line: string }
  /** Added to the conversation's open question. */
  | { kind: "appended"; question: TeamQuestion; line: string }
  /** Nobody can take it now (closed, nobody reachable): asked, and the chat joins the team queue. */
  | { kind: "offline"; question: TeamQuestion; line: string }
  /** Not allowed: the caller hands off as usual. */
  | { kind: "refused"; reason: QuickCheckRefusal };

/** What the dashboard shows for a question waiting on the team. */
export interface TeamQuestionView {
  id: string;
  conversationId: string;
  question: string;
  customerMessage: string | null;
  status: TeamQuestion["status"];
  askedAt: string;
  timedOutAt: string | null;
  channel: string;
  customerName: string | null;
  conversationTitle: string | null;
}

function languagesOf(conversation: Conversation, language?: string | null) {
  return [language, conversation.language, conversation.organization?.defaultLanguage] as const;
}

function contactEmailOf(conversation: Conversation): string | null {
  const contact = conversation.metadata?.contactEmail;
  return (typeof contact === "string" && contact) || conversation.customer?.email || null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  pt: "Brazilian Portuguese",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
};

function languageName(language: string | null | undefined): string {
  const base = (language ?? "en").toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] ?? language ?? "English";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

class TeamQuestionService {
  private repo() {
    return AppDataSource.getRepository(TeamQuestion);
  }

  // -------------------------------------------------------------------------
  // Asking (D19-1, D19-8, D19-12)
  // -------------------------------------------------------------------------

  /**
   * The AI could not answer a fact. Ask the team when the rules allow it:
   * someone reachable → T0 line and timers; closed or nobody reachable → the
   * question is stored for the team and the chat joins the queue now.
   * Sends nothing itself: the caller sends `line` (through its reply gate).
   */
  async ask(
    conversation: Conversation,
    input: { question: string; customerMessage: string | null; language?: string | null },
    now: Date = new Date(),
  ): Promise<AskResult> {
    const settings = resolveQuickCheckSettings(conversation.organization?.settings);
    const questionText = clip(input.question || input.customerMessage || "", MAX_QUESTION_LENGTH);
    if (!questionText) return { kind: "refused", reason: "disabled" };

    const [open, inConversation, inOrganization] = await Promise.all([
      this.repo().findOne({ where: { conversationId: conversation.id, status: "open" } }),
      this.repo().count({ where: { conversationId: conversation.id } }),
      this.repo().count({
        where: {
          organizationId: conversation.organization_id,
          askedAt: MoreThan(new Date(now.getTime() - 60 * 60_000)),
        },
      }),
    ]);

    const decision = decideQuickCheck({
      settings,
      isTest: isTestConversation(conversation.metadata),
      spamFlagged: !!conversation.spam_flagged_at,
      repliesHeldForReview: aiRepliesHeldForReview(conversation),
      hasOpenQuestion: !!open,
      questionsInConversation: inConversation,
      questionsInOrganizationLastHour: inOrganization,
    });
    const copy = quickCheckCopy(...languagesOf(conversation, input.language));

    if (decision.action === "refuse") {
      logger.info(
        { conversationId: conversation.id, reason: decision.reason },
        "Quick check not allowed, handing off",
      );
      return { kind: "refused", reason: decision.reason };
    }
    if (decision.action === "append" && open) {
      open.question = clip(`${open.question}\n${questionText}`, MAX_QUESTION_LENGTH);
      await this.repo().update({ id: open.id }, { question: open.question });
      await this.publishChange(conversation.organization_id, open.id);
      return { kind: "appended", question: open, line: copy.appended };
    }

    const availability = await getAvailability(
      { organizationId: conversation.organization_id, channel: conversation.channel },
      now,
    );
    const reachable = availability.state === "open";
    let question: TeamQuestion;
    try {
      question = await this.repo().save(
        this.repo().create({
          organizationId: conversation.organization_id,
          conversationId: conversation.id,
          question: questionText,
          customerMessage: input.customerMessage
            ? clip(input.customerMessage, MAX_QUESTION_LENGTH)
            : null,
          language: input.language ?? conversation.language ?? null,
          status: reachable ? "open" : "timed_out",
          askedAt: now,
          timedOutAt: reachable ? null : now,
        }),
      );
    } catch (error) {
      // Another run opened one a moment ago (one open question per conversation).
      logger.warn({ err: error, conversationId: conversation.id }, "Could not open a question");
      return { kind: "refused", reason: "conversation_limit" };
    }
    await this.publishChange(conversation.organization_id, question.id);

    if (reachable) {
      logger.info({ conversationId: conversation.id, questionId: question.id }, "Asked the team");
      return { kind: "asked", question, line: copy.asked(settings.giveUpAfterMinutes) };
    }
    logger.info(
      { conversationId: conversation.id, questionId: question.id, state: availability.state },
      "Team not reachable for a quick check, queued for the team",
    );
    return {
      kind: "offline",
      question,
      line: quickCheckOfflineLine(availability, now, ...languagesOf(conversation, input.language)),
    };
  }

  /**
   * End the shopper-facing wait: the conversation joins the team queue
   * (pending-human, which alerts the team and stamps handed_off_at) until the
   * question is answered (Roger, D19 answer 2). Leaves closed or already
   * waiting conversations as they are.
   */
  async moveToTeamQueue(conversationId: string, questionId: string): Promise<void> {
    const current = await conversationRepository.findById(conversationId);
    if (!current || current.status !== "open") return;
    await conversationRepository.update(current.id, current.organization_id, {
      status: "pending-human",
      metadata: { ...(current.metadata ?? {}), teamQuestionHandoff: questionId },
    });
    void import("@server/orchestrator/conversation-utils").then(({ generateHandoffSummary }) =>
      generateHandoffSummary(current.id, current.organization_id, true).catch((error) =>
        logger.error({ err: error, conversationId }, "Error generating handoff summary"),
      ),
    );
  }

  /**
   * Say a fixed quick-check line from outside an AI run (the sweep, a
   * dismiss). Re-checks that the AI may speak first; returns false when not.
   */
  private async say(
    conversationId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    if (await recheckAiReply(conversationId)) return false;
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) return false;
    await conversation.addMessage({
      content,
      type: MessageType.BOT_AGENT,
      metadata: { isTeamQuestionMessage: true, ...metadata },
    });
    return true;
  }

  /**
   * Ask the people (D19-3, D19-5): push every active member and email each a
   * one-field answer link. A question that went straight to the team queue
   * skips the push: the hand-off alert already went out. Never throws.
   */
  async notifyTeam(
    conversation: Conversation,
    question: TeamQuestion,
    options: { push: boolean },
  ): Promise<void> {
    try {
      const { conversationAlertService } = await import("../conversation-alert.service");
      const { answerLink } = await import("./answer-token");
      const result = await conversationAlertService.onTeamQuestion(conversation, question, {
        push: options.push,
        answerLink: (userId) => answerLink(question.id, userId),
      });
      logger.info({ questionId: question.id, ...result }, "Team asked");
    } catch (error) {
      logger.error({ err: error, questionId: question.id }, "Could not alert the team");
    }
  }

  // -------------------------------------------------------------------------
  // Answer and relay (D19-4)
  // -------------------------------------------------------------------------

  /**
   * A teammate answered. Claims the question (only one answer ever counts),
   * relays it to the shopper (the AI's grounded rephrase, or as written) on
   * the conversation's channel, on time or late, and hands the chat back to
   * the AI when the question was what put it in the team queue.
   */
  async answer(input: {
    questionId: string;
    organizationId: string;
    userId: string;
    answer: string;
    relayMode: TeamAnswerRelayMode;
    saveToKnowledge: boolean;
  }): Promise<{ delivered: boolean }> {
    const answer = input.answer.trim();
    if (!answer) throw new TRPCError({ code: "BAD_REQUEST", message: "Write an answer first." });
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This answer is too long." });
    }

    const now = new Date();
    const claimed = await this.repo()
      .createQueryBuilder()
      .update(TeamQuestion)
      .set({
        status: "answered",
        answer,
        answeredBy: input.userId,
        answeredAt: now,
        relayMode: input.relayMode,
        saveToKnowledge: input.saveToKnowledge,
      })
      .where("id = :id AND organization_id = :organizationId AND status IN ('open', 'timed_out')", {
        id: input.questionId,
        organizationId: input.organizationId,
      })
      .execute();
    if (!claimed.affected) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This question was already answered or closed.",
      });
    }
    const question = (await this.repo().findOneBy({ id: input.questionId }))!;
    const delivered = await this.relay(question, input.userId);
    await this.publishChange(input.organizationId, question.id);
    return { delivered };
  }

  private async relay(question: TeamQuestion, userId: string): Promise<boolean> {
    const conversation = await conversationRepository.findById(question.conversationId);
    if (!conversation) return false;
    const late = !!question.timedOutAt;
    const answer = question.answer ?? "";
    const blocker = await recheckAiReply(conversation.id);

    let content = answer;
    if (!blocker && question.relayMode === "rephrase") {
      content = (await this.rephrase(conversation, question, late)) ?? answer;
    }

    // The AI may not speak (paused, or someone holds the chat): the
    // teammate's words go out as theirs, as written.
    let type: MessageType = MessageType.BOT_AGENT;
    let sender: string | undefined;
    if (blocker) {
      if (blocker === "conversation_missing") return false;
      const { userRepository } = await import("@server/repositories/user.repository");
      const user = await userRepository.findById(userId);
      type = MessageType.HUMAN_AGENT;
      sender = user?.getFullName() || undefined;
      content = answer;
    }

    await conversation.addMessage({
      content,
      type,
      sender,
      metadata: {
        isTeamAnswer: true,
        teamQuestionId: question.id,
        relayMode: blocker ? "verbatim" : question.relayMode,
        answeredBy: userId,
        late,
      },
    });
    await this.repo().update({ id: question.id }, { deliveredAt: new Date() });

    // Hand the chat back to the AI when this question put it in the queue.
    const current = await conversationRepository.findById(conversation.id);
    if (current) {
      const metadata = { ...(current.metadata ?? {}) };
      const backToAi =
        current.status === "pending-human" &&
        !current.assigned_user_id &&
        metadata.teamQuestionHandoff === question.id;
      delete metadata.teamQuestionHandoff;
      await conversationRepository.update(current.id, current.organization_id, {
        metadata,
        ...(backToAi ? { status: "open" as const } : {}),
      });
    }

    // A web shopper who left gets it by email, when they gave an address (D5-9).
    // Human replies already take that path through channel delivery.
    if (type === MessageType.BOT_AGENT && conversation.channel === "web") {
      const { emailHumanReplyIfAway } = await import("../web-follow-up.service");
      await emailHumanReplyIfAway(conversation, {
        content,
        sender: conversation.organization?.name ?? null,
      }).catch((error) => logger.warn({ err: error }, "Follow-up email failed"));
    }
    return true;
  }

  /**
   * The AI passes the answer on in the shopper's language, using nothing but
   * the answer. Null on any failure or an implausible result: the caller
   * sends the answer as written.
   */
  private async rephrase(
    conversation: Conversation,
    question: TeamQuestion,
    late: boolean,
  ): Promise<string | null> {
    try {
      const { PromptService } = await import("../prompt.service");
      const { LLMService } = await import("../core/llm.service");
      const language =
        question.language || conversation.language || conversation.organization?.defaultLanguage;
      const prompt = await PromptService.getInstance().getPrompt(
        "conversation/team-answer-relay",
        {
          question: question.question,
          answer: question.answer ?? "",
          late,
          languageName: languageName(language),
        },
        { conversationId: conversation.id, organizationId: conversation.organization_id },
      );
      const text = await new LLMService().invoke({
        prompt,
        history: "Write the message now.",
        tier: "easy",
        organizationId: conversation.organization_id,
      });
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!trimmed || trimmed.length > MAX_ANSWER_LENGTH) return null;
      return trimmed;
    } catch (error) {
      logger.warn({ err: error, questionId: question.id }, "Rephrase failed, sending as written");
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Timers (D19-2)
  // -------------------------------------------------------------------------

  /** 1-minute sweep: the T+5 update and the T+10 end of the wait. Idempotent. */
  async runSweep(now: Date = new Date()): Promise<void> {
    const due = await this.repo().find({
      where: { status: "open" },
      order: { askedAt: "ASC" },
      take: SWEEP_BATCH,
    });
    for (const question of due) {
      try {
        await this.advance(question, now);
      } catch (error) {
        logger.error({ err: error, questionId: question.id }, "Quick-check timer step failed");
      }
    }
  }

  private async advance(question: TeamQuestion, now: Date): Promise<void> {
    const conversation = await conversationRepository.findById(question.conversationId);
    if (!conversation || CLOSED_STATUSES.includes(conversation.status)) {
      // The shopper is gone; the question stays answerable as a late answer.
      await this.claimTimeout(question.id, now);
      return;
    }
    const settings = resolveQuickCheckSettings(conversation.organization?.settings);
    const step = dueTimerStep(question, settings, now);
    if (step === "give_up") return this.giveUp(question.id, conversation, now);
    if (step === "update") return this.sendUpdate(question.id, conversation, settings, now);
  }

  /** Claim the end of the wait; true for the one caller that moved it. */
  private async claimTimeout(questionId: string, now: Date): Promise<boolean> {
    const result = await this.repo()
      .createQueryBuilder()
      .update(TeamQuestion)
      .set({ status: "timed_out", timedOutAt: now })
      .where("id = :id AND status = 'open'", { id: questionId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private async sendUpdate(
    questionId: string,
    conversation: Conversation,
    settings: ReturnType<typeof resolveQuickCheckSettings>,
    now: Date,
  ): Promise<void> {
    const claimed = await this.repo()
      .createQueryBuilder()
      .update(TeamQuestion)
      .set({ updateSentAt: now })
      .where("id = :id AND status = 'open' AND update_sent_at IS NULL", { id: questionId })
      .execute();
    if (!claimed.affected) return;
    const question = await this.repo().findOneBy({ id: questionId });
    const copy = quickCheckCopy(...languagesOf(conversation, question?.language));
    await this.say(conversation.id, copy.stillChecking(minutesLeftAfterUpdate(settings)), {
      teamQuestionId: questionId,
      quickCheckStep: "update",
    });
  }

  /** T+10 (or a dismissed open question): end the wait, hand the chat to the team. */
  private async giveUp(questionId: string, conversation: Conversation, now: Date): Promise<void> {
    if (!(await this.claimTimeout(questionId, now))) return;
    const question = await this.repo().findOneBy({ id: questionId });
    await this.endWait(conversation, questionId, question?.language ?? null, "gave_up");
  }

  private async endWait(
    conversation: Conversation,
    questionId: string,
    language: string | null,
    step: "gave_up" | "dismissed",
  ): Promise<void> {
    await this.moveToTeamQueue(conversation.id, questionId);
    const copy = quickCheckCopy(...languagesOf(conversation, language));
    const email = contactEmailOf(conversation);
    const variant = gaveUpVariant(conversation.channel, email);
    const line =
      variant === "email"
        ? copy.gaveUpEmail(maskEmail(email!))
        : variant === "leave_email"
          ? copy.gaveUpLeaveEmail
          : copy.gaveUp;
    await this.say(conversation.id, line, {
      teamQuestionId: questionId,
      quickCheckStep: step,
      isHandoffMessage: true,
    });
    await this.publishChange(conversation.organization_id, questionId);
  }

  // -------------------------------------------------------------------------
  // Team surface (D19-3)
  // -------------------------------------------------------------------------

  /** Questions the team can still answer, oldest first. */
  async listAnswerable(organizationId: string): Promise<TeamQuestionView[]> {
    const rows: Array<{
      id: string;
      conversation_id: string;
      question: string;
      customer_message: string | null;
      status: TeamQuestion["status"];
      asked_at: Date;
      timed_out_at: Date | null;
      channel: string;
      customer_name: string | null;
      title: string | null;
    }> = await AppDataSource.query(
      `SELECT q.id, q.conversation_id, q.question, q.customer_message, q.status, q.asked_at,
              q.timed_out_at, c.channel, cust.name AS customer_name, c.title
         FROM team_questions q
         JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
         LEFT JOIN customers cust ON cust.id = c.customer_id
        WHERE q.organization_id = $1
          AND q.status IN ('open', 'timed_out')
        ORDER BY q.asked_at ASC
        LIMIT 100`,
      [organizationId],
    );
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      question: row.question,
      customerMessage: row.customer_message,
      status: row.status,
      askedAt: new Date(row.asked_at).toISOString(),
      timedOutAt: row.timed_out_at ? new Date(row.timed_out_at).toISOString() : null,
      channel: row.channel,
      customerName: row.customer_name,
      conversationTitle: row.title,
    }));
  }

  async findAnswerable(questionId: string, organizationId: string): Promise<TeamQuestion | null> {
    return this.repo().findOne({
      where: {
        id: questionId,
        organizationId,
        status: In([...ANSWERABLE_TEAM_QUESTION_STATUSES]),
      },
    });
  }

  /**
   * A teammate chose not to answer. An open question still owes the shopper
   * the update they were promised, so the wait ends now and the chat joins
   * the team queue.
   */
  async dismiss(questionId: string, organizationId: string, userId: string): Promise<void> {
    const before = await this.findAnswerable(questionId, organizationId);
    if (!before) {
      throw new TRPCError({ code: "CONFLICT", message: "This question was already handled." });
    }
    const result = await this.repo()
      .createQueryBuilder()
      .update(TeamQuestion)
      .set({ status: "dismissed", closedBy: userId })
      .where("id = :id AND status IN ('open', 'timed_out')", { id: questionId })
      .execute();
    if (!result.affected) {
      throw new TRPCError({ code: "CONFLICT", message: "This question was already handled." });
    }
    if (before.status === "open") {
      const conversation = await conversationRepository.findById(before.conversationId);
      if (conversation && !CLOSED_STATUSES.includes(conversation.status)) {
        await this.endWait(conversation, questionId, before.language, "dismissed");
        return;
      }
    }
    await this.publishChange(organizationId, questionId);
  }

  /**
   * Keep questions in step with the conversation (called on every status
   * transition): a take-over cancels them (the person answers in the chat
   * themselves); any other move to the team queue ends the timers, so the
   * shopper isn't told "still checking" while waiting for a person.
   */
  async onConversationStatusChanged(conversation: Conversation): Promise<void> {
    if (conversation.status === "human-took-over") {
      const result = await this.repo()
        .createQueryBuilder()
        .update(TeamQuestion)
        .set({ status: "cancelled", closedBy: conversation.assigned_user_id ?? null })
        .where("conversation_id = :id AND status IN ('open', 'timed_out')", {
          id: conversation.id,
        })
        .execute();
      if (result.affected) await this.publishChange(conversation.organization_id, null);
      return;
    }
    if (conversation.status === "pending-human") {
      const result = await this.repo()
        .createQueryBuilder()
        .update(TeamQuestion)
        .set({ status: "timed_out", timedOutAt: new Date() })
        .where("conversation_id = :id AND status = 'open'", { id: conversation.id })
        .execute();
      if (result.affected) await this.publishChange(conversation.organization_id, null);
    }
  }

  /** Conversation ids with a question on its timers (the inactivity reaper leaves them alone). */
  async conversationIdsWithOpenQuestion(): Promise<Set<string>> {
    const rows = await this.repo().find({
      select: { conversationId: true },
      where: { status: "open" },
    });
    return new Set(rows.map((row) => row.conversationId));
  }

  /** Tell dashboards the Questions list changed. Best effort. */
  async publishChange(organizationId: string, questionId: string | null): Promise<void> {
    try {
      const payload = { questionId };
      const { redisService } = await import("../redis.service");
      if (redisService.isConnected()) {
        await redisService.publish("websocket:events", {
          type: "team_question_changed",
          organizationId,
          payload,
        });
        return;
      }
      const { websocketService } = await import("../websocket.service");
      websocketService.sendToOrganization(organizationId, {
        type: "team_question_changed",
        payload,
      });
    } catch (error) {
      logger.warn({ err: error, organizationId }, "Could not publish team_question_changed");
    }
  }
}

export type { TeamAnswerRelayMode };
export const teamQuestionService = new TeamQuestionService();
