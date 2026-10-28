import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * organizationAccessService.setAccessState — the single write path the
 * operator uses to suspend/unsuspend an organization and set its notice.
 */

type OrgRow = {
  id: string;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  suspensionRedirectUrl: string | null;
  agentPausedAt: Date | null;
  agentPauseReason: string | null;
  accessNotice: Record<string, unknown> | null;
  aiPausedAt?: Date | null;
  aiPausedByUserId?: string | null;
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
};

const rows = new Map<string, OrgRow>();
const mockRepository = {
  findOneBy: jest.fn(async ({ id }: { id: string }) => rows.get(id) ?? null),
  save: jest.fn(async (row: OrgRow) => {
    rows.set(row.id, row);
    return row;
  }),
  update: jest.fn(async ({ id }: { id: string }, changes: Partial<OrgRow>) => {
    const row = rows.get(id);
    if (row) rows.set(id, { ...row, ...changes });
    return { affected: row ? 1 : 0 };
  }),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => mockRepository },
}));

const mockAuditLog = jest.fn(async (_options: unknown) => ({}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { log: mockAuditLog },
}));

const mockSendToOrganization = jest.fn((_organizationId: string, _message: unknown) => 1);
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToOrganization: mockSendToOrganization },
}));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import {
  organizationAccessService,
  ORGANIZATION_ACCESS_CHANGED_EVENT,
} from "@server/services/organization-access.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

describe("organizationAccessService.setAccessState", () => {
  beforeEach(() => {
    rows.clear();
    rows.set(ORG_ID, {
      id: ORG_ID,
      suspendedAt: null,
      suspensionReason: null,
      suspensionRedirectUrl: null,
      agentPausedAt: null,
      agentPauseReason: null,
      accessNotice: null,
    });
    jest.clearAllMocks();
  });

  it("returns null for an unknown organization", async () => {
    const result = await organizationAccessService.setAccessState({
      organizationId: "22222222-2222-4222-8222-222222222222",
      suspension: { reason: "manual" },
      agentPause: null,
      notice: null,
    });
    expect(result).toBeNull();
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it("suspends with reason + redirect, audits and notifies connected dashboards", async () => {
    const result = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "trial_expired", redirectUrl: "https://hay.chat/billing/locked/" },
      agentPause: null,
      notice: { key: "trial_expired", level: "critical" },
    });

    expect(result?.suspendedAt).toBeInstanceOf(Date);
    expect(result?.suspensionReason).toBe("trial_expired");
    expect(result?.suspensionRedirectUrl).toBe("https://hay.chat/billing/locked/");
    expect(result?.accessNotice).toEqual({ key: "trial_expired", level: "critical" });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        action: "organization.access_state_changed",
      }),
    );
    expect(mockSendToOrganization).toHaveBeenCalledWith(ORG_ID, {
      type: ORGANIZATION_ACCESS_CHANGED_EVENT,
      payload: result,
    });
  });

  it("keeps the original suspendedAt when the operator re-sends a suspension", async () => {
    const first = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "trial_expired" },
      agentPause: null,
      notice: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "payment_failed" },
      agentPause: null,
      notice: null,
    });

    expect(second?.suspendedAt?.getTime()).toBe(first?.suspendedAt?.getTime());
    expect(second?.suspensionReason).toBe("payment_failed");
  });

  it("clears every suspension field and the notice on unsuspend", async () => {
    await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "manual", redirectUrl: "https://example.com/locked" },
      agentPause: null,
      notice: { key: "x", level: "info" },
    });
    const result = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: null,
      notice: null,
    });

    expect(result).toEqual({
      suspendedAt: null,
      suspensionReason: null,
      suspensionRedirectUrl: null,
      agentPausedAt: null,
      agentPauseReason: null,
      accessNotice: null,
      billingPeriod: null,
      aiPausedAt: null,
      aiPausedByUserId: null,
    });
  });

  it("can set a notice without suspending (e.g. trial countdown)", async () => {
    const result = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: null,
      notice: { key: "trial_ending", level: "warning", params: { date: "31 Oct 2026" } },
    });
    expect(result?.suspendedAt).toBeNull();
    expect(result?.accessNotice?.key).toBe("trial_ending");
  });

  it("still returns the state when the audit log fails", async () => {
    mockAuditLog.mockRejectedValueOnce(new Error("db down"));
    const result = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "manual" },
      agentPause: null,
      notice: null,
    });
    expect(result?.suspensionReason).toBe("manual");
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("pauses the AI agent without suspending, keeps the original agentPausedAt and resumes on null", async () => {
    const first = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: { reason: "usage_limit" },
      notice: { key: "usage_paused", level: "critical" },
    });
    expect(first?.agentPausedAt).toBeInstanceOf(Date);
    expect(first?.agentPauseReason).toBe("usage_limit");
    expect(first?.suspendedAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: { reason: "usage_limit" },
      notice: null,
    });
    expect(second?.agentPausedAt?.getTime()).toBe(first?.agentPausedAt?.getTime());

    const resumed = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: null,
      notice: null,
    });
    expect(resumed?.agentPausedAt).toBeNull();
    expect(resumed?.agentPauseReason).toBeNull();
    expect(mockSendToOrganization).toHaveBeenLastCalledWith(ORG_ID, {
      type: ORGANIZATION_ACCESS_CHANGED_EVENT,
      payload: resumed,
    });
  });
});

describe("organizationAccessService.setOwnerAiPause (D11-9)", () => {
  const USER_ID = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    rows.clear();
    rows.set(ORG_ID, {
      id: ORG_ID,
      suspendedAt: null,
      suspensionReason: null,
      suspensionRedirectUrl: null,
      agentPausedAt: null,
      agentPauseReason: null,
      accessNotice: null,
      aiPausedAt: null,
      aiPausedByUserId: null,
    });
    jest.clearAllMocks();
  });

  it("pauses with the author, audits who did it and tells every dashboard", async () => {
    const state = await organizationAccessService.setOwnerAiPause({
      organizationId: ORG_ID,
      userId: USER_ID,
      paused: true,
    });

    expect(state?.aiPausedAt).toBeInstanceOf(Date);
    expect(state?.aiPausedByUserId).toBe(USER_ID);
    expect(rows.get(ORG_ID)?.aiPausedByUserId).toBe(USER_ID);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        action: "organization.ai_paused",
      }),
    );
    expect(mockSendToOrganization).toHaveBeenCalledWith(ORG_ID, {
      type: ORGANIZATION_ACCESS_CHANGED_EVENT,
      payload: expect.objectContaining({ aiPausedByUserId: USER_ID }),
    });
  });

  it("keeps the first author when paused again, and audits nothing new", async () => {
    await organizationAccessService.setOwnerAiPause({
      organizationId: ORG_ID,
      userId: USER_ID,
      paused: true,
    });
    jest.clearAllMocks();
    const state = await organizationAccessService.setOwnerAiPause({
      organizationId: ORG_ID,
      userId: "44444444-4444-4444-8444-444444444444",
      paused: true,
    });
    expect(state?.aiPausedByUserId).toBe(USER_ID);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it("resumes and audits it", async () => {
    rows.set(ORG_ID, { ...rows.get(ORG_ID)!, aiPausedAt: new Date(), aiPausedByUserId: USER_ID });
    const state = await organizationAccessService.setOwnerAiPause({
      organizationId: ORG_ID,
      userId: USER_ID,
      paused: false,
    });
    expect(state?.aiPausedAt).toBeNull();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "organization.ai_resumed", userId: USER_ID }),
    );
  });

  it("is left alone by the operator's access-state sync", async () => {
    const pausedAt = new Date("2026-10-28T09:00:00Z");
    rows.set(ORG_ID, { ...rows.get(ORG_ID)!, aiPausedAt: pausedAt, aiPausedByUserId: USER_ID });
    const state = await organizationAccessService.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: null,
      notice: null,
    });
    expect(state?.aiPausedAt).toEqual(pausedAt);
  });
});

describe("organizationAccessService.setBillingPeriod", () => {
  const period = {
    start: new Date("2026-10-14T09:30:00Z"),
    end: new Date("2026-11-14T09:30:00Z"),
  };

  beforeEach(() => {
    rows.clear();
    rows.set(ORG_ID, {
      id: ORG_ID,
      suspendedAt: null,
      suspensionReason: null,
      suspensionRedirectUrl: null,
      agentPausedAt: null,
      agentPauseReason: null,
      accessNotice: null,
      billingPeriodStart: null,
      billingPeriodEnd: null,
    });
    jest.clearAllMocks();
  });

  it("stores the period, returns it in the access state and writes only on a change", async () => {
    const state = await organizationAccessService.setBillingPeriod({
      organizationId: ORG_ID,
      period,
    });
    expect(state?.billingPeriod).toEqual(period);
    expect(mockRepository.update).toHaveBeenCalledTimes(1);

    await organizationAccessService.setBillingPeriod({
      organizationId: ORG_ID,
      period: { start: new Date(period.start), end: new Date(period.end) },
    });
    expect(mockRepository.update).toHaveBeenCalledTimes(1);

    const cleared = await organizationAccessService.setBillingPeriod({
      organizationId: ORG_ID,
      period: null,
    });
    expect(cleared?.billingPeriod).toBeNull();
    expect(mockRepository.update).toHaveBeenCalledTimes(2);
  });

  it("returns null for an unknown organization", async () => {
    expect(
      await organizationAccessService.setBillingPeriod({ organizationId: "nope", period }),
    ).toBeNull();
  });
});
