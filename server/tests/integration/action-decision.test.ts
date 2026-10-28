/**
 * D4-5: deciding on a held action. Approve runs the action exactly once (even
 * on a double approve), reject never runs it, and both queue one AI turn.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";

const mockExecuteApproved =
  jest.fn<
    (...args: unknown[]) => Promise<{ success: boolean; error?: string; errorCode: string | null }>
  >();
const mockEnqueue = jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));
jest.mock("../../services/core/tool-execution.service", () => ({
  ToolExecutionService: class {
    executeApprovedAction = mockExecuteApproved;
  },
}));
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));
const mockRunFollowUp = jest.fn<(conversationId: string) => Promise<void>>();
jest.mock("../../orchestrator/run", () => {
  class ConversationLockedError extends Error {}
  return { runApprovalFollowUp: mockRunFollowUp, ConversationLockedError };
});

import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { PendingAction } from "../../database/entities/pending-action.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { HANDLED_BY_TEAM_NOTE, pendingActionService } from "../../services/pending-action.service";
import { actionDecisionService } from "../../services/action-decision.service";
import { decidedActionsLedger } from "../../orchestrator/decided-actions";

const orgId = "da4e0000-0000-4000-8000-000000000005";
const userId = "da4e0000-0000-4000-8000-0000000000a5";
const decider = { userId };

async function newConversation(status: Conversation["status"] = "awaiting-approval") {
  const conversations = AppDataSource.getRepository(Conversation);
  return conversations.save(
    conversations.create({ organization_id: orgId, title: "decision", status, metadata: {} }),
  );
}

function hold(conversationId: string) {
  return pendingActionService.hold({
    organizationId: orgId,
    conversationId,
    pluginId: "shop",
    toolName: "shop:create_refund",
    category: "refund",
    args: { order_id: "1001", amount: "25.00" },
    amount: 25,
    holdReason: "money_move",
    expiryHours: 48,
  });
}

async function statusOf(conversationId: string) {
  const row = await AppDataSource.getRepository(Conversation).findOneBy({ id: conversationId });
  return row?.status;
}

async function systemNotes(conversationId: string) {
  return AppDataSource.getRepository(Message).find({
    where: { conversation_id: conversationId, type: MessageType.SYSTEM },
  });
}

describe("action decisions (D4-5)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Decision Org", slug: "decision-org" }));
    }
    const users = AppDataSource.getRepository(User);
    if (!(await users.findOne({ where: { id: userId } }))) {
      await users.save(
        users.create({
          id: userId,
          email: "approver@decision.test",
          password: "x",
        } as Partial<User>),
      );
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnqueue.mockResolvedValue(true);
    mockExecuteApproved.mockResolvedValue({ success: true, errorCode: null });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(PendingAction).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
  });

  it("approve: runs once with the stored key, marks executed, resumes the AI", async () => {
    const conversation = await newConversation();
    const action = await hold(conversation.id);

    const results = await Promise.all([
      actionDecisionService.approve(action.id, orgId, decider),
      actionDecisionService.approve(action.id, orgId, decider),
    ]);

    expect(results.filter((r) => r.transitioned)).toHaveLength(1);
    expect(mockExecuteApproved).toHaveBeenCalledTimes(1);
    const [, executed] = mockExecuteApproved.mock.calls[0] as [unknown, PendingAction];
    expect(executed.idempotency_key).toBe(action.idempotency_key);

    // A third, late approve does nothing either.
    const late = await actionDecisionService.approve(action.id, orgId, decider);
    expect(late.transitioned).toBe(false);
    expect(mockExecuteApproved).toHaveBeenCalledTimes(1);

    expect((await pendingActionService.findById(action.id, orgId))?.status).toBe("executed");
    expect(await statusOf(conversation.id)).toBe("open");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(conversation.id, orgId, "approval_decided");
    const notes = await systemNotes(conversation.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain("APPROVED");
  });

  it("approve: a failing tool marks the action failed and tells the AI it was not done", async () => {
    mockExecuteApproved.mockResolvedValue({
      success: false,
      error: "Order already refunded",
      errorCode: "PRECONDITION",
    });
    const conversation = await newConversation();
    const action = await hold(conversation.id);

    await actionDecisionService.approve(action.id, orgId, decider);

    const row = await pendingActionService.findById(action.id, orgId);
    expect(row).toMatchObject({ status: "failed", error_code: "PRECONDITION" });
    const notes = await systemNotes(conversation.id);
    expect(notes[0].content).toContain("NOT done");
  });

  it("reject: never runs the action and passes the reason to the AI", async () => {
    const conversation = await newConversation();
    const action = await hold(conversation.id);

    const result = await actionDecisionService.reject(action.id, orgId, decider, "Past 30 days");

    expect(result.transitioned).toBe(true);
    expect(mockExecuteApproved).not.toHaveBeenCalled();
    expect(await statusOf(conversation.id)).toBe("open");
    expect(mockEnqueue).toHaveBeenCalledWith(conversation.id, orgId, "approval_decided");
    expect((await systemNotes(conversation.id))[0].content).toContain("Past 30 days");
  });

  it("hands the follow-up turn the decisions it answers", async () => {
    const conversation = await newConversation();
    const approved = await hold(conversation.id);
    const declined = await hold(conversation.id);
    await actionDecisionService.approve(approved.id, orgId, decider);
    await actionDecisionService.reject(declined.id, orgId, decider, "Needs a photo");

    const row = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });

    expect(await decidedActionsLedger(row)).toEqual([
      { name: "shop:create_refund", success: true, decision: "approved" },
      { name: "shop:create_refund", success: false, decision: "declined" },
    ]);
  });

  it("stays awaiting approval while another action is still pending", async () => {
    const conversation = await newConversation();
    const first = await hold(conversation.id);
    await pendingActionService.hold({
      organizationId: orgId,
      conversationId: conversation.id,
      pluginId: "shop",
      toolName: "shop:cancel_order",
      category: "cancel",
      args: { order_id: "1001" },
      amount: null,
      holdReason: "money_move",
      expiryHours: 48,
    });

    await actionDecisionService.reject(first.id, orgId, decider, null);

    expect(await statusOf(conversation.id)).toBe("awaiting-approval");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("reply myself: closes the request without an AI turn and queues it for the team", async () => {
    const conversation = await newConversation();
    const action = await hold(conversation.id);

    await actionDecisionService.replyMyself(action.id, orgId, decider);

    const row = await pendingActionService.findById(action.id, orgId);
    expect(row).toMatchObject({ status: "rejected", decision_note: HANDLED_BY_TEAM_NOTE });
    expect(await statusOf(conversation.id)).toBe("pending-human");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockExecuteApproved).not.toHaveBeenCalled();
    // Handed to the team is not "declined": a later identical call is not
    // answered with "a team member already declined this".
    expect(
      await pendingActionService.findEarlierRequest(conversation.id, action.tool_name, action.args),
    ).toBeNull();
  });

  it("hands to the team instead of an AI turn when the channel's reply window closed", async () => {
    const conversation = await newConversation();
    await AppDataSource.getRepository(Conversation).update(conversation.id, {
      reply_window_expires_at: new Date(Date.now() - 60_000),
    });
    const action = await hold(conversation.id);

    await actionDecisionService.approve(action.id, orgId, decider);

    expect(mockExecuteApproved).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(await statusOf(conversation.id)).toBe("pending-human");
    const notes = (await systemNotes(conversation.id)).map((n) => n.content).join("\n");
    expect(notes).toContain("approved and done");
    expect(notes).toContain("reply window");
  });

  it("still resumes the AI while the reply window is open", async () => {
    const conversation = await newConversation();
    await AppDataSource.getRepository(Conversation).update(conversation.id, {
      reply_window_expires_at: new Date(Date.now() + 3600_000),
    });
    const action = await hold(conversation.id);

    await actionDecisionService.reject(action.id, orgId, decider, null);

    expect(await statusOf(conversation.id)).toBe("open");
    expect(mockEnqueue).toHaveBeenCalledWith(conversation.id, orgId, "approval_decided");
  });

  it.each(["resolved", "unresolved", "closed"] as const)(
    "approve on a %s conversation does not run the action",
    async (status) => {
      const conversation = await newConversation(status);
      const action = await hold(conversation.id);

      const result = await actionDecisionService.approve(action.id, orgId, decider);

      expect(result).toMatchObject({ transitioned: false, blocked: "conversation_closed" });
      expect(mockExecuteApproved).not.toHaveBeenCalled();
      expect((await pendingActionService.findById(action.id, orgId))?.status).toBe("pending");
    },
  );

  it("without a queue, retries the follow-up while another run holds the lock", async () => {
    const { ConversationLockedError } = jest.requireMock<{
      ConversationLockedError: new () => Error;
    }>("../../orchestrator/run");
    mockEnqueue.mockResolvedValue(false);
    mockRunFollowUp
      .mockRejectedValueOnce(new ConversationLockedError())
      .mockResolvedValueOnce(undefined);
    actionDecisionService.followUpRetryMs = 5;
    const conversation = await newConversation();
    const action = await hold(conversation.id);

    await actionDecisionService.reject(action.id, orgId, decider, null);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockRunFollowUp).toHaveBeenCalledTimes(2);
    expect(mockRunFollowUp).toHaveBeenCalledWith(conversation.id);
  });

  it("does not resume the AI when a human took over meanwhile", async () => {
    const conversation = await newConversation("human-took-over");
    const action = await hold(conversation.id);

    await actionDecisionService.approve(action.id, orgId, decider);

    expect(mockExecuteApproved).toHaveBeenCalledTimes(1);
    expect(await statusOf(conversation.id)).toBe("human-took-over");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("action expiry (D4-8)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });

  beforeEach(() => {
    mockExecuteApproved.mockReset();
    mockEnqueue.mockReset();
  });

  afterAll(async () => {
    await AppDataSource.getRepository(PendingAction).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.destroy();
  });

  async function holdPastDeadline(conversationId: string, messageId?: string) {
    const action = await pendingActionService.hold({
      organizationId: orgId,
      conversationId,
      messageId,
      pluginId: "shop",
      toolName: "shop:create_refund",
      category: "refund",
      args: { order_id: "2002", amount: "10.00" },
      amount: 10,
      holdReason: "money_move",
      expiryHours: 48,
    });
    await AppDataSource.getRepository(PendingAction).update(action.id, {
      expires_at: new Date(Date.now() - 60_000),
    });
    return action;
  }

  function messagesOf(conversationId: string, type: MessageType) {
    return AppDataSource.getRepository(Message).find({
      where: { conversation_id: conversationId, type },
    });
  }

  it("expires without running, tells the shopper in their language, hands off once", async () => {
    const conversation = await newConversation();
    await AppDataSource.getRepository(Conversation).update(conversation.id, { language: "pt-BR" });
    const tool = await AppDataSource.getRepository(Message).save(
      AppDataSource.getRepository(Message).create({
        conversation_id: conversation.id,
        type: MessageType.TOOL,
        content: "Awaiting approval: shop:create_refund",
        metadata: { toolStatus: "PENDING_APPROVAL" },
      }),
    );
    const action = await holdPastDeadline(conversation.id, tool.id);

    expect(await actionDecisionService.expireDue()).toBeGreaterThanOrEqual(1);
    await actionDecisionService.expireDue(); // a second run changes nothing

    expect(await pendingActionService.findById(action.id, orgId)).toMatchObject({
      status: "expired",
    });
    expect(mockExecuteApproved).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(await statusOf(conversation.id)).toBe("pending-human");

    const shopper = await messagesOf(conversation.id, MessageType.BOT_AGENT);
    expect(shopper).toHaveLength(1);
    expect(shopper[0].content).toContain("não foi feita");
    const updatedTool = await AppDataSource.getRepository(Message).findOneBy({ id: tool.id });
    expect(updatedTool?.metadata?.toolStatus).toBe("EXPIRED");
    expect(await pendingActionService.approve(action.id, orgId, decider)).toMatchObject({
      transitioned: false,
    });
  });

  it("leaves a conversation a human took over alone", async () => {
    const conversation = await newConversation("human-took-over");
    const action = await holdPastDeadline(conversation.id);

    await actionDecisionService.expireDue();

    expect(await pendingActionService.findById(action.id, orgId)).toMatchObject({
      status: "expired",
    });
    expect(await statusOf(conversation.id)).toBe("human-took-over");
    expect(await messagesOf(conversation.id, MessageType.BOT_AGENT)).toHaveLength(0);
  });
});
