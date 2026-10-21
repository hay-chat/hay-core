import { describe, expect, it } from "vitest";
import { resolveConnection } from "./connection.js";

describe("resolveConnection", () => {
  it("uses the Embedded Signup token and stored ids by default", () => {
    expect(
      resolveConnection({}, { accessToken: "tok", phoneNumberId: "1", wabaId: "2", businessId: "3" }),
    ).toEqual({ mode: "embedded-signup", accessToken: "tok", phoneNumberId: "1", wabaId: "2", businessId: "3" });
  });

  it("is not connected until onConnected stored the ids", () => {
    expect(resolveConnection({}, { accessToken: "tok" })).toBeNull();
  });

  it("uses the pasted token in manual mode and ignores OAuth credentials", () => {
    const connection = resolveConnection(
      {
        connectionMode: "manual",
        manualAccessToken: " pasted ",
        manualPhoneNumberId: "976350592236691",
        manualWabaId: "42",
        manualAppSecret: "secret",
        manualVerifyToken: "verify",
      },
      { accessToken: "oauth", phoneNumberId: "1", wabaId: "2" },
    );
    expect(connection).toEqual({
      mode: "manual",
      accessToken: "pasted",
      phoneNumberId: "976350592236691",
      wabaId: "42",
      appSecret: "secret",
      verifyToken: "verify",
    });
  });

  it("is not connected in manual mode with missing fields", () => {
    expect(resolveConnection({ connectionMode: "manual", manualAccessToken: "t" }, undefined)).toBeNull();
  });
});
