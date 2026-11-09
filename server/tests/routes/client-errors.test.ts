import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import { authRouter } from "@server/routes/v1/auth";
import { invitationsRouter } from "@server/routes/v1/invitations";
import { privacyRouter } from "@server/routes/v1/privacy";
import { privacyService, PrivacyRequestError } from "@server/services/privacy.service";

const caller = () => privacyRouter.createCaller({ ipAddress: "10.0.0.1" } as never);

afterEach(() => jest.restoreAllMocks());

describe("privacy router errors", () => {
  it("hides unexpected failures behind a generic message", async () => {
    jest
      .spyOn(privacyService, "confirmExport")
      .mockRejectedValue(new Error('relation "privacy_requests" does not exist'));

    await expect(caller().confirmExport({ token: "t" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to confirm the export request",
    });
  });

  it("keeps the wording of a refusal", async () => {
    jest
      .spyOn(privacyService, "confirmExport")
      .mockRejectedValue(new PrivacyRequestError("Verification token has expired"));

    const error = await caller()
      .confirmExport({ token: "t" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: "Verification token has expired" });
  });
});

describe("auth.getRecentSecurityEvents", () => {
  it("caps the page size", () => {
    const [input] = authRouter._def.procedures.getRecentSecurityEvents._def.inputs as unknown as [
      { safeParse(value: unknown): { success: boolean } },
    ];

    expect(input.safeParse({ limit: 100 }).success).toBe(true);
    expect(input.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe("token-bearing procedures", () => {
  it.each([
    ["auth.verifyResetToken", authRouter._def.procedures.verifyResetToken],
    ["invitations.getInvitationByToken", invitationsRouter._def.procedures.getInvitationByToken],
    ["privacy.downloadExport", privacyRouter._def.procedures.downloadExport],
  ])("%s is a mutation, so the token never goes in a URL", (_name, procedure) => {
    expect((procedure as unknown as { _def: { type: string } })._def.type).toBe("mutation");
  });
});
