import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { TeamQuestion } from "../../database/entities/team-question.entity";
import { NotificationDelivery } from "../../database/entities/notification-delivery.entity";
import { ConversationRepository } from "../../repositories/conversation.repository";

const mockSendToUser = jest.fn<
  (
    userId: string,
    payload: Record<string, unknown>,
  ) => Promise<{
    devices: number;
    sent: number;
    removed: number;
  }>
>();
const mockSendTemplateEmail =
  jest.fn<(options: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>>();
const mockAvailability = jest.fn<() => Promise<Record<string, unknown>>>();
const mockLlm = jest.fn<(options: Record<string, unknown>) => Promise<string>>();

jest.mock("../../services/push-notification.service", () => ({
  pushNotificationService: {
    sendToUser: (userId: string, payload: Record<string, unknown>) =>
      mockSendToUser(userId, payload),
  },
}));
jest.mock("../../services/email.service", () => ({
  emailService: {
    sendTemplateEmail: (options: Record<string, unknown>) => mockSendTemplateEmail(options),
  },
  getOrganizationLocale: async () => "en",
}));
jest.mock("../../services/business-hours.service", () => ({
  getAvailability: () => mockAvailability(),
  isWithinBusinessHours: async () => true,
}));
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
    broadcastMessageReceived: jest.fn(),
  },
}));
jest.mock("../../services/core/llm.service", () => ({
  LLMService: class {
    invoke = (options: Record<string, unknown>) => mockLlm(options);
  },
}));
jest.mock("../../orchestrator/conversation-utils", () => ({
  generateHandoffSummary: async () => undefined,
}));

import { teamQuestionService } from "../../services/team-questions/team-question.service";

/**
 * D19 quick check against the real database: asking, limits, the 1-minute
 * timers (time moved by back-dating asked_at), answers on time and late,
 * dismiss, take-over and approval mode.
 */
describe("quick check with the team", () => {
  const orgId = "d1900000-0000-4000-8000-000000000001";
  const memberId = "d1900000-0000-4000-8000-0000000000a1";
  const awayId = "d1900000-0000-4000-8000-0000000000a2";
  const repository = new ConversationRepository();
  const questions = () => AppDataSource.getRepository(TeamQuestion);

  const open = {
    state: "open",
    nextOpening: null,
    timezone: "Europe/Lisbon",
    localTime: "",
    hasSchedule: false,
  };

  async function setQuickCheck(settings: Record<string, unknown>) {
    await AppDataSource.getRepository(Organization).update({ id: orgId }, { settings });
  }

  async function chat(channel = "web"): Promise<Conversation> {
    const created = await repository.create({
      title: "Vase",
      organization_id: orgId,
      status: "open",
      channel,
    });
    return (await repository.findById(created.id))!;
  }

  async function ask(
    conversation: Conversation,
    question = "Does the 40 cm vase ship in a gift box?",
  ) {
    return teamQuestionService.ask(conversation, {
      question,
      customerMessage: question,
      language: "en",
    });
  }

  async function botLines(conversationId: string): Promise<Message[]> {
    return AppDataSource.getRepository(Message).find({
      where: { conversation_id: conversationId, type: MessageType.BOT_AGENT },
      order: { created_at: "ASC" },
    });
  }

  async function backdate(questionId: string, minutes: number) {
    await AppDataSource.query(
      `UPDATE team_questions SET asked_at = asked_at - ($2 || ' minutes')::interval WHERE id = $1`,
      [questionId, String(minutes)],
    );
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Vase Shop", slug: "vase-shop-d19" }));
    }
    const users = AppDataSource.getRepository(User);
    const memberships = AppDataSource.getRepository(UserOrganization);
    for (const [id, status] of [
      [memberId, "available"],
      [awayId, "away"],
    ] as const) {
      if (!(await users.findOne({ where: { id } }))) {
        await users.save(
          users.create({ id, email: `${id}@example.com`, password: "x", firstName: "Ana", status }),
        );
      }
      if (!(await memberships.findOne({ where: { userId: id, organizationId: orgId } }))) {
        await memberships.save(
          memberships.create({ userId: id, organizationId: orgId, role: "member", isActive: true }),
        );
      }
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSendToUser.mockResolvedValue({ devices: 1, sent: 1, removed: 0 });
    mockSendTemplateEmail.mockResolvedValue({ success: true });
    mockAvailability.mockResolvedValue(open);
    mockLlm.mockResolvedValue(
      "Thanks for waiting! The team confirmed: yes, it ships in a gift box.",
    );
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await setQuickCheck({ quickCheck: { enabled: true } });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(UserOrganization).delete({ organizationId: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    for (const id of [memberId, awayId]) await AppDataSource.getRepository(User).delete({ id });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("asks the team, alerts every active member, keeps the conversation open (D19-1, D19-3, D19-5)", async () => {
    const conversation = await chat();
    const result = await ask(conversation);

    expect(result.kind).toBe("asked");
    if (result.kind !== "asked") return;
    expect(result.line).toContain("within 10 minutes");
    expect(result.question.status).toBe("open");
    expect((await repository.findById(conversation.id))?.status).toBe("open");

    await teamQuestionService.notifyTeam(conversation, result.question, { push: true });
    // Every active member, Available or not (Roger, D19 answer 5).
    expect(mockSendToUser.mock.calls.map(([userId]) => userId).sort()).toEqual(
      [memberId, awayId].sort(),
    );
    expect(mockSendToUser.mock.calls[0][1]).toMatchObject({
      kind: "team_question",
      tag: `team_question:${result.question.id}`,
      url: `/inbox?question=${result.question.id}&org=${orgId}`,
    });
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(2);
    const email = mockSendTemplateEmail.mock.calls[0][0] as {
      variables: { actionButton: { url: string }; details: Array<{ value: string }> };
    };
    expect(email.variables.actionButton.url).toMatch(/\/answer-question\?token=/);
    expect(email.variables.details[0].value).toBe("Does the 40 cm vase ship in a gift box?");

    // Claimed per recipient: a second call sends nothing new.
    await teamQuestionService.notifyTeam(conversation, result.question, { push: true });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    const steps = await AppDataSource.getRepository(NotificationDelivery).find({
      where: { conversation_id: conversation.id },
    });
    expect(steps.map((row) => row.step).sort()).toEqual([
      "question",
      "question",
      "question_email",
      "question_email",
    ]);
  });

  it("appends a second fact, then hands off after two checks (D19-8)", async () => {
    const conversation = await chat();
    const first = await ask(conversation);
    const appended = await ask(conversation, "And does it come in blue?");
    expect(appended.kind).toBe("appended");
    if (first.kind !== "asked") throw new Error("expected asked");
    const stored = await questions().findOneByOrFail({ id: first.question.id });
    expect(stored.question).toBe(
      "Does the 40 cm vase ship in a gift box?\nAnd does it come in blue?",
    );

    await teamQuestionService.answer({
      questionId: first.question.id,
      organizationId: orgId,
      userId: memberId,
      answer: "Yes, and yes.",
      relayMode: "verbatim",
      saveToKnowledge: true,
    });
    expect((await ask(conversation, "Second question?")).kind).toBe("asked");
    // Answer it so nothing is open, then the third check is refused.
    const second = await questions().findOneByOrFail({
      conversationId: conversation.id,
      status: "open",
    });
    await teamQuestionService.answer({
      questionId: second.id,
      organizationId: orgId,
      userId: memberId,
      answer: "No.",
      relayMode: "verbatim",
      saveToKnowledge: false,
    });
    expect(await ask(conversation, "Third?")).toEqual({
      kind: "refused",
      reason: "conversation_limit",
    });
  });

  it("is off by default and in approval mode (D19-8)", async () => {
    await setQuickCheck({});
    expect(await ask(await chat())).toEqual({ kind: "refused", reason: "disabled" });

    await setQuickCheck({ quickCheck: { enabled: true }, testModeDefault: true });
    expect(await ask(await chat())).toEqual({ kind: "refused", reason: "approval" });
  });

  it("sends the update at T+5 once, ends the wait at T+10 into the team queue (D19-2)", async () => {
    const conversation = await chat();
    const result = await ask(conversation);
    if (result.kind !== "asked") throw new Error("expected asked");
    const id = result.question.id;

    await teamQuestionService.runSweep();
    expect(await botLines(conversation.id)).toHaveLength(0);

    await backdate(id, 6);
    await teamQuestionService.runSweep();
    await teamQuestionService.runSweep();
    let lines = await botLines(conversation.id);
    expect(lines.map((m) => m.content)).toEqual([
      "Still checking with the team. I'll update you here in about 5 minutes either way.",
    ]);
    expect(lines[0].metadata).toMatchObject({ isTeamQuestionMessage: true, teamQuestionId: id });

    await backdate(id, 5);
    await teamQuestionService.runSweep();
    await teamQuestionService.runSweep();
    lines = await botLines(conversation.id);
    expect(lines).toHaveLength(2);
    // Web, no email yet: the widget shows its email form while the chat waits.
    expect(lines[1].content).toBe(
      "I couldn't get that answer from the team yet. I've passed your question on. Leave your email below so the team can reply to you there.",
    );
    const after = await repository.findById(conversation.id);
    expect(after?.status).toBe("pending-human");
    expect(after?.handed_off_at).toBeTruthy();
    expect(after?.metadata?.teamQuestionHandoff).toBe(id);
    expect((await questions().findOneByOrFail({ id })).status).toBe("timed_out");

    // A late answer is still delivered and hands the chat back to the AI.
    const delivered = await teamQuestionService.answer({
      questionId: id,
      organizationId: orgId,
      userId: memberId,
      answer: "Yes, every 40 cm vase ships in a gift box.",
      relayMode: "rephrase",
      saveToKnowledge: true,
    });
    expect(delivered).toEqual({ delivered: true });
    expect(mockLlm).toHaveBeenCalledTimes(1);
    lines = await botLines(conversation.id);
    expect(lines[2].metadata).toMatchObject({
      isTeamAnswer: true,
      late: true,
      relayMode: "rephrase",
    });
    const back = await repository.findById(conversation.id);
    expect(back?.status).toBe("open");
    expect(back?.metadata?.teamQuestionHandoff).toBeUndefined();
    const answered = await questions().findOneByOrFail({ id });
    expect(answered.status).toBe("answered");
    expect(answered.deliveredAt).toBeTruthy();

    // Single use.
    await expect(
      teamQuestionService.answer({
        questionId: id,
        organizationId: orgId,
        userId: awayId,
        answer: "Again",
        relayMode: "verbatim",
        saveToKnowledge: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("names the masked email on web, and the chat on other channels, at T+10", async () => {
    const web = await chat();
    await repository.update(web.id, orgId, { metadata: { contactEmail: "roger@gmail.com" } });
    const whatsapp = await chat("whatsapp");
    for (const conversation of [await repository.findById(web.id), whatsapp]) {
      const result = await ask(conversation!);
      if (result.kind !== "asked") throw new Error("expected asked");
      await backdate(result.question.id, 11);
    }
    await teamQuestionService.runSweep();
    expect((await botLines(web.id))[0].content).toContain("or by email at r***@gmail.com");
    expect((await botLines(whatsapp.id))[0].content).toBe(
      "I couldn't get that answer from the team yet. I've passed your question on, and they'll reply to you here in this chat.",
    );
  });

  it("relays an on-time answer as written, or the AI's rephrase", async () => {
    const conversation = await chat();
    const result = await ask(conversation);
    if (result.kind !== "asked") throw new Error("expected asked");
    await teamQuestionService.answer({
      questionId: result.question.id,
      organizationId: orgId,
      userId: memberId,
      answer: "Yes, gift box included.",
      relayMode: "verbatim",
      saveToKnowledge: false,
    });
    const [line] = await botLines(conversation.id);
    expect(line.content).toBe("Yes, gift box included.");
    expect(line.metadata).toMatchObject({ isTeamAnswer: true, late: false });
    expect(mockLlm).not.toHaveBeenCalled();
    const conv = await repository.findById(conversation.id);
    expect(conv?.status).toBe("open");
  });

  it("goes straight to the team queue when the team is closed (D19-12)", async () => {
    mockAvailability.mockResolvedValue({
      ...open,
      state: "closed",
      nextOpening: new Date(Date.now() + 2 * 86_400_000),
    });
    const conversation = await chat();
    const result = await ask(conversation);
    expect(result.kind).toBe("offline");
    if (result.kind !== "offline") return;
    expect(result.line).toMatch(
      /^I don't have that information, and the team is away right now, back /,
    );
    expect(result.question.status).toBe("timed_out");
    await teamQuestionService.moveToTeamQueue(conversation.id, result.question.id);
    expect((await repository.findById(conversation.id))?.status).toBe("pending-human");
    // Still answerable from the Inbox.
    expect((await teamQuestionService.listAnswerable(orgId)).map((q) => q.id)).toContain(
      result.question.id,
    );
  });

  it("cancels on take-over, and stops the timers on another hand-off (D19-3)", async () => {
    const taken = await chat();
    const a = await ask(taken);
    await repository.update(taken.id, orgId, {
      status: "human-took-over",
      assigned_user_id: memberId,
    });
    if (a.kind !== "asked") throw new Error("expected asked");
    expect(await questions().findOneByOrFail({ id: a.question.id })).toMatchObject({
      status: "cancelled",
      closedBy: memberId,
    });

    const handedOff = await chat();
    const b = await ask(handedOff);
    await repository.update(handedOff.id, orgId, { status: "pending-human" });
    if (b.kind !== "asked") throw new Error("expected asked");
    expect((await questions().findOneByOrFail({ id: b.question.id })).status).toBe("timed_out");
    await backdate(b.question.id, 20);
    await teamQuestionService.runSweep();
    expect(await botLines(handedOff.id)).toHaveLength(0);
  });

  it("dismissing an open question still keeps the promise to the shopper", async () => {
    const conversation = await chat("whatsapp");
    const result = await ask(conversation);
    if (result.kind !== "asked") throw new Error("expected asked");
    await teamQuestionService.dismiss(result.question.id, orgId, memberId);
    expect((await questions().findOneByOrFail({ id: result.question.id })).status).toBe(
      "dismissed",
    );
    expect((await repository.findById(conversation.id))?.status).toBe("pending-human");
    expect((await botLines(conversation.id))[0].metadata).toMatchObject({
      quickCheckStep: "dismissed",
      isHandoffMessage: true,
    });
    await expect(
      teamQuestionService.dismiss(result.question.id, orgId, memberId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
