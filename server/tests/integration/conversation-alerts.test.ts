import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
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
const mockWithinHours = jest.fn<() => Promise<boolean>>();

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
  getOrganizationLocale: async () => "pt", // org languages are short codes
}));
jest.mock("../../services/business-hours.service", () => ({
  isWithinBusinessHours: () => mockWithinHours(),
}));
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
  },
}));

import { conversationAlertService } from "../../services/conversation-alert.service";

/**
 * D11-8 against the real database: who is alerted, the recorded ladder
 * (initial push -> re-push -> email), cancellation, and business hours.
 * Time is moved by back-dating the recorded rows.
 */
describe("conversation alert ladder", () => {
  const orgId = "a1e47000-0000-4000-8000-000000000001";
  const availableId = "a1e47000-0000-4000-8000-0000000000a1";
  const awayId = "a1e47000-0000-4000-8000-0000000000a2";
  const leftId = "a1e47000-0000-4000-8000-0000000000a3";
  const repository = new ConversationRepository();
  const deliveries = () => AppDataSource.getRepository(NotificationDelivery);

  async function waitingConversation(): Promise<Conversation> {
    const conversation = await repository.create({
      title: "Refund",
      summary: "Wants a refund for a damaged item.",
      organization_id: orgId,
      status: "pending-human",
    });
    await conversationAlertService.onConversationStatusChanged(conversation);
    return conversation;
  }

  /** Pretend the rows of this conversation were written `minutes` earlier. */
  async function backdate(conversationId: string, minutes: number): Promise<void> {
    await AppDataSource.query(
      `UPDATE notification_deliveries
          SET cycle_started_at = cycle_started_at - ($2 || ' minutes')::interval,
              created_at = created_at - ($2 || ' minutes')::interval
        WHERE conversation_id = $1`,
      [conversationId, String(minutes)],
    );
  }

  const steps = async (conversationId: string) =>
    (await deliveries().find({ where: { conversation_id: conversationId } }))
      .map((row) => `${row.step}:${row.channel}:${row.status}`)
      .sort();

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Alert Org", slug: "alert-org-d11" }));
    }
    const users = AppDataSource.getRepository(User);
    const memberships = AppDataSource.getRepository(UserOrganization);
    const people: Array<[string, "available" | "away", boolean]> = [
      [availableId, "available", true],
      [awayId, "away", true],
      [leftId, "available", false],
    ];
    for (const [id, status, membershipActive] of people) {
      if (!(await users.findOne({ where: { id } }))) {
        await users.save(
          users.create({ id, email: `${id}@example.com`, password: "x", firstName: "Ana", status }),
        );
      }
      if (!(await memberships.findOne({ where: { userId: id, organizationId: orgId } }))) {
        await memberships.save(
          memberships.create({
            userId: id,
            organizationId: orgId,
            role: "member",
            isActive: membershipActive,
          }),
        );
      }
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSendToUser.mockResolvedValue({ devices: 1, sent: 1, removed: 0 });
    mockSendTemplateEmail.mockResolvedValue({ success: true });
    mockWithinHours.mockResolvedValue(true);
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(UserOrganization).delete({ organizationId: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    for (const id of [availableId, awayId, leftId]) {
      await AppDataSource.getRepository(User).delete({ id });
    }
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("alerts only active, Available members and records the push", async () => {
    const conversation = await waitingConversation();

    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = mockSendToUser.mock.calls[0];
    expect(userId).toBe(availableId);
    expect(payload).toMatchObject({
      title: "Um cliente precisa de um humano",
      body: "Refund: Wants a refund for a damaged item.",
      url: `/conversations/${conversation.id}?org=${orgId}`,
    });
    expect(await steps(conversation.id)).toEqual(["initial:push:sent"]);
  });

  it("records no_device for a member without devices", async () => {
    mockSendToUser.mockResolvedValue({ devices: 0, sent: 0, removed: 0 });
    const conversation = await waitingConversation();
    expect(await steps(conversation.id)).toEqual(["initial:push:no_device"]);
  });

  it("re-pushes after 10 minutes, then emails 10 minutes later, then stops", async () => {
    const conversation = await waitingConversation();

    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual(["initial:push:sent"]);

    await backdate(conversation.id, 11);
    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual(["initial:push:sent", "repush:push:sent"]);
    expect(mockSendToUser.mock.calls[1][1]).toMatchObject({
      title: "Um cliente ainda está esperando um humano",
    });

    // A second sweep in the same minute does nothing new
    await conversationAlertService.runEscalationSweep();
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    expect(mockSendTemplateEmail).not.toHaveBeenCalled();

    await backdate(conversation.id, 11);
    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual([
      "email:email:sent",
      "initial:push:sent",
      "repush:push:sent",
    ]);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);
    const email = mockSendTemplateEmail.mock.calls[0][0] as {
      to: string;
      locale: string;
      template: string;
      subject: string;
      variables: { actionButton: { url: string } };
    };
    expect(email.to).toBe(`${availableId}@example.com`);
    expect(email.template).toBe("notification");
    expect(email.locale).toBe("pt-BR");
    expect(email.subject).toBe("Refund ainda está esperando uma resposta");
    expect(email.variables.actionButton.url).toContain(
      `/conversations/${conversation.id}?org=${orgId}`,
    );

    await backdate(conversation.id, 60);
    await conversationAlertService.runEscalationSweep();
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
  });

  it("emails right away when the re-push reached no device", async () => {
    mockSendToUser.mockResolvedValue({ devices: 0, sent: 0, removed: 0 });
    const conversation = await waitingConversation();
    await backdate(conversation.id, 11);

    await conversationAlertService.runEscalationSweep(); // re-push (no device)
    await conversationAlertService.runEscalationSweep(); // email

    expect(await steps(conversation.id)).toEqual([
      "email:email:sent",
      "initial:push:no_device",
      "repush:push:no_device",
    ]);
  });

  it("waits outside business hours", async () => {
    mockWithinHours.mockResolvedValue(false);
    const conversation = await waitingConversation();
    await backdate(conversation.id, 120);

    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual(["initial:push:sent"]);

    mockWithinHours.mockResolvedValue(true);
    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual(["initial:push:sent", "repush:push:sent"]);
  });

  it("is cancelled by a human reply", async () => {
    const conversation = await waitingConversation();
    await AppDataSource.getRepository(Message).save(
      AppDataSource.getRepository(Message).create({
        conversation_id: conversation.id,
        type: MessageType.HUMAN_AGENT,
        content: "Hi, Marina here",
      }),
    );
    await backdate(conversation.id, 30);

    await conversationAlertService.runEscalationSweep();
    expect(await steps(conversation.id)).toEqual(["initial:push:sent"]);
  });

  it("is cancelled by a take-over or a close", async () => {
    const takenOver = await waitingConversation();
    const closed = await waitingConversation();
    await AppDataSource.getRepository(Conversation).update(
      { id: takenOver.id },
      { status: "human-took-over", assigned_user_id: availableId },
    );
    await AppDataSource.getRepository(Conversation).update({ id: closed.id }, { status: "closed" });
    await backdate(takenOver.id, 30);
    await backdate(closed.id, 30);

    await conversationAlertService.runEscalationSweep();
    expect(await steps(takenOver.id)).toEqual(["initial:push:sent"]);
    expect(await steps(closed.id)).toEqual(["initial:push:sent"]);
  });
});
