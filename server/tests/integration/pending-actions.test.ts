/**
 * D4-3: pending_actions status transitions are atomic and move forward only.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { PendingAction } from "../../database/entities/pending-action.entity";
import {
  pendingActionService,
  canApproveActions,
  deciderOf,
} from "../../services/pending-action.service";
import type { AuthUser } from "../../lib/auth/AuthUser";

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));
const mockTrigger = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("../../services/hooks/hook-manager", () => ({
  hookManager: { trigger: (...args: unknown[]) => mockTrigger(...args) },
}));

const orgId = "da4e0000-0000-4000-8000-000000000001";
const userId = "da4e0000-0000-4000-8000-0000000000aa";
const decider = { userId };

async function holdOne(conversationId: string, overrides: Partial<{ expiryHours: number }> = {}) {
  return pendingActionService.hold({
    organizationId: orgId,
    conversationId,
    pluginId: "shop",
    toolName: "shop:create_refund",
    category: "refund",
    args: { order_id: "1001", amount: "25.00" },
    amount: 25,
    holdReason: "money_move",
    expiryHours: overrides.expiryHours ?? 48,
  });
}

describe("pending actions (D4-3)", () => {
  let conversationId: string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(
        orgs.create({ id: orgId, name: "Pending Actions Org", slug: "pending-actions-org" }),
      );
    }
    const users = AppDataSource.getRepository(User);
    if (!(await users.findOne({ where: { id: userId } }))) {
      await users.save(
        users.create({
          id: userId,
          email: "approver@pending-actions.test",
          password: "x",
        } as Partial<User>),
      );
    }
    const conversations = AppDataSource.getRepository(Conversation);
    const conversation = await conversations.save(
      conversations.create({
        organization_id: orgId,
        title: "pending actions",
        status: "open",
        metadata: {},
      }),
    );
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await AppDataSource.getRepository(PendingAction).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.destroy();
  });

  it("holds an action with its own idempotency key and a 48h deadline", async () => {
    const action = await holdOne(conversationId);
    expect(action.status).toBe("pending");
    expect(action.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    const hours = (action.expires_at.getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(await pendingActionService.hasPending(conversationId)).toBe(true);
  });

  it("approves once: concurrent approvals move the row exactly once", async () => {
    const action = await holdOne(conversationId);
    const results = await Promise.all([
      pendingActionService.approve(action.id, orgId, decider),
      pendingActionService.approve(action.id, orgId, decider),
      pendingActionService.approve(action.id, orgId, decider),
    ]);
    expect(results.filter((r) => r.transitioned)).toHaveLength(1);
    expect(results.every((r) => r.action?.status === "approved")).toBe(true);

    const executed = await pendingActionService.markExecuted(results[0].action!);
    expect(executed?.status).toBe("executed");
    // Already executed: neither a re-execute nor a reject moves it.
    expect(await pendingActionService.markExecuted(results[0].action!)).toBeNull();
    expect(
      (await pendingActionService.reject(action.id, orgId, decider, "late")).transitioned,
    ).toBe(false);
  });

  it("rejects with a reason and refuses a later approval", async () => {
    const action = await holdOne(conversationId);
    const rejected = await pendingActionService.reject(action.id, orgId, decider, "Too large");
    expect(rejected).toMatchObject({ transitioned: true, action: { status: "rejected" } });
    expect(rejected.action?.decision_note).toBe("Too large");
    expect((await pendingActionService.approve(action.id, orgId, decider)).transitioned).toBe(
      false,
    );
    const same = { order_id: "1001", amount: "25.00" };
    expect(
      (await pendingActionService.findEarlierRequest(conversationId, "shop:create_refund", same))
        ?.status,
    ).toBe("rejected");
    // A different order is a different request.
    expect(
      await pendingActionService.findEarlierRequest(conversationId, "shop:create_refund", {
        order_id: "1002",
        amount: "25.00",
      }),
    ).toBeNull();
  });

  it("does not approve an action past its deadline, and expires it", async () => {
    const action = await holdOne(conversationId, { expiryHours: -1 });
    expect((await pendingActionService.approve(action.id, orgId, decider)).transitioned).toBe(
      false,
    );
    const expired = await pendingActionService.expireDue();
    expect(expired.map((row) => row.id)).toContain(action.id);
    expect((await pendingActionService.findById(action.id, orgId))?.status).toBe("expired");
    // A second sweep finds nothing new for it.
    expect((await pendingActionService.expireDue()).map((row) => row.id)).not.toContain(action.id);
  });

  it("an API key decision stores no user and keeps the key id in the event", async () => {
    const action = await holdOne(conversationId);
    const decided = await pendingActionService.approve(
      action.id,
      orgId,
      deciderOf({ authMethod: "apikey", apiKeyId: "key-1", id: "api-token-key-1" } as AuthUser),
    );
    expect(decided).toMatchObject({ transitioned: true, action: { decided_by: null } });
    expect(mockTrigger).toHaveBeenCalledWith(
      "action_approved",
      expect.objectContaining({
        metadata: expect.objectContaining({ userId: null, apiKeyId: "key-1" }),
      }),
    );
  });

  it("does not let another organization decide", async () => {
    const action = await holdOne(conversationId);
    const other = "da4e0000-0000-4000-8000-000000000999";
    expect((await pendingActionService.approve(action.id, other, decider)).transitioned).toBe(
      false,
    );
  });
});

describe("canApproveActions", () => {
  const user = (role: string, permissions: string[] = []) =>
    ({
      authMethod: "jwt",
      getRole: () => role,
      userOrganization: { permissions },
      hasScope: () => false,
    }) as unknown as AuthUser;
  const defaults = { approverRoles: ["owner", "admin"] as Array<"owner" | "admin"> };

  it("lets owner and admin approve by default", () => {
    expect(canApproveActions(user("owner"), defaults)).toBe(true);
    expect(canApproveActions(user("admin"), defaults)).toBe(true);
    expect(canApproveActions(user("member"), defaults)).toBe(false);
  });

  it("is configurable per role, and the owner always keeps it", () => {
    expect(canApproveActions(user("admin"), { approverRoles: [] })).toBe(false);
    expect(canApproveActions(user("owner"), { approverRoles: [] })).toBe(true);
    expect(canApproveActions(user("member"), { approverRoles: ["member"] })).toBe(true);
  });

  it("honours an explicit per-user actions:approve permission", () => {
    expect(canApproveActions(user("member", ["actions:approve"]), defaults)).toBe(true);
  });
});
