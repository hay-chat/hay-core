import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { TRPCError } from "@trpc/server";

/**
 * Invitations grant what the sender can still grant, join only organizations
 * in good standing, and answer a stale decline with a client error.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: {
    logInvitationAccept: jest.fn(async () => undefined),
    logInvitationDecline: jest.fn(async () => undefined),
    logInvitationSend: jest.fn(async () => undefined),
  },
}));
jest.mock("@server/services/email.service", () => ({
  emailService: { initialize: jest.fn(async () => undefined), sendTemplateEmail: jest.fn() },
  getOrganizationLocale: jest.fn(async () => "en"),
}));

type Row = Record<string, unknown>;
const invitationFindOne = jest.fn<(options: unknown) => Promise<Row | null>>();
const userFindOne = jest.fn<(options: { where: { id?: string } }) => Promise<Row | null>>();
const membershipFindOne =
  jest.fn<(options: { where: { userId: string } }) => Promise<Row | null>>();
const membershipSave = jest.fn(async (row: Row) => row);
const invitationSave = jest.fn(async (row: Row) => row);

jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) => {
      if (entity.name === "OrganizationInvitation") {
        return { findOne: invitationFindOne, save: invitationSave };
      }
      if (entity.name === "User") return { findOne: userFindOne };
      if (entity.name === "UserOrganization") {
        return {
          findOne: membershipFindOne,
          save: membershipSave,
          create: (row: Row) => row,
        };
      }
      return { findOne: async () => null };
    },
  },
}));

import { invitationsRouter, renewedInvitationExpiry } from "@server/routes/v1/invitations";
import type { Context } from "@server/trpc/context";

const INVITER = "11111111-1111-4111-8111-111111111111";
const INVITEE = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

const pendingInvitation = (over: Row = {}): Row => ({
  id: "i1",
  email: "New.Person@Example.com",
  organizationId: ORG,
  invitedBy: INVITER,
  role: "admin",
  permissions: null,
  status: "pending",
  createdAt: new Date(),
  organization: { name: "Acme", isActive: true, suspendedAt: null },
  canAccept: () => true,
  accept: jest.fn(),
  decline: jest.fn(),
  ...over,
});

const membership = (hasInvite: boolean, role = "admin"): Row => ({
  isActive: true,
  role,
  hasScope: () => hasInvite,
});

const inviterUser: Row = { id: INVITER, email: "a@b.c", isActive: true };

const caller = invitationsRouter.createCaller({
  user: { id: INVITEE },
  organizationId: null,
  req: { headers: {} },
  res: {},
} as unknown as Context);

/** The invitee is not a member; the inviter's membership is the given row. */
function givenInviter(inviterMembership: Row | null, user: Row | null = inviterUser): void {
  userFindOne.mockImplementation(async ({ where }) =>
    where.id === INVITEE ? { id: INVITEE, email: "new.person@example.com" } : user,
  );
  membershipFindOne.mockImplementation(async ({ where }) =>
    where.userId === INVITER ? inviterMembership : null,
  );
}

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  const result = await promise.catch((error: unknown) => error);
  return result instanceof TRPCError ? result.code : undefined;
};

describe("invitations", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepts while the inviter can still invite", async () => {
    invitationFindOne.mockResolvedValue(pendingInvitation());
    givenInviter(membership(true));

    await expect(caller.acceptInvitation({ token: "t" })).resolves.toMatchObject({ success: true });
    expect(membershipSave).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["removed from the organization", null, inviterUser],
    ["deactivated in the organization", { ...membership(true), isActive: false }, inviterUser],
    ["no longer allowed to invite", membership(false), inviterUser],
    ["a deactivated account", membership(true), { ...inviterUser, isActive: false }],
  ])("refuses when the inviter is %s", async (_name, inviterMembership, user) => {
    invitationFindOne.mockResolvedValue(pendingInvitation());
    givenInviter(inviterMembership, user);

    expect(await codeOf(caller.acceptInvitation({ token: "t" }))).toBe("FORBIDDEN");
    expect(membershipSave).not.toHaveBeenCalled();
  });

  it("refuses an owner invitation once the inviter stopped being an owner", async () => {
    invitationFindOne.mockResolvedValue(pendingInvitation({ role: "owner" }));
    givenInviter(membership(true, "admin"));

    expect(await codeOf(caller.acceptInvitation({ token: "t" }))).toBe("FORBIDDEN");
    expect(membershipSave).not.toHaveBeenCalled();
  });

  it.each([
    ["suspended", { name: "Acme", isActive: true, suspendedAt: new Date() }],
    ["deactivated", { name: "Acme", isActive: false, suspendedAt: null }],
  ])("refuses to join a %s organization", async (_name, organization) => {
    invitationFindOne.mockResolvedValue(pendingInvitation({ organization }));
    givenInviter(membership(true));

    expect(await codeOf(caller.acceptInvitation({ token: "t" }))).toBe("FORBIDDEN");
    expect(membershipSave).not.toHaveBeenCalled();
  });

  it("answers declining a used invitation with a client error", async () => {
    invitationFindOne.mockResolvedValue(pendingInvitation({ status: "accepted" }));

    expect(await codeOf(caller.declineInvitation({ token: "t" }))).toBe("BAD_REQUEST");
  });

  it("renews by a week but never beyond 30 days from creation", () => {
    const day = 24 * 60 * 60 * 1000;
    const createdAt = new Date("2026-01-01T00:00:00Z");

    expect(renewedInvitationExpiry(createdAt, new Date(createdAt.getTime() + day)).getTime()).toBe(
      createdAt.getTime() + 8 * day,
    );
    expect(
      renewedInvitationExpiry(createdAt, new Date(createdAt.getTime() + 29 * day)).getTime(),
    ).toBe(createdAt.getTime() + 30 * day);
  });
});
