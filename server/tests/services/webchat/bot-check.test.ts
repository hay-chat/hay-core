import { describe, it, expect } from "@jest/globals";
import { isBotFlagged, isVerificationUnavailable } from "@server/services/webchat/bot-check";

const flag = (...reasons: Array<string | undefined>) => ({
  decision: "flag",
  results: reasons.map((reason) => ({ pluginId: "p", decision: "flag", reason })),
});

describe("bot check record", () => {
  it("is not a bot signal when the visitor passed or nothing ran", () => {
    expect(isBotFlagged(undefined)).toBe(false);
    expect(isBotFlagged({ decision: "allow", results: [] })).toBe(false);
  });

  it("is a bot signal when the visitor skipped or failed the challenge", () => {
    expect(isBotFlagged(flag("token_missing"))).toBe(true);
    expect(isBotFlagged(flag("challenge_error:600010"))).toBe(true);
    expect(isBotFlagged(flag("challenge_error:expired"))).toBe(true);
    expect(isBotFlagged(flag(undefined))).toBe(true);
    // An old record without per-plugin results stays a bot signal.
    expect(isBotFlagged({ decision: "flag" })).toBe(true);
  });

  it("is not a bot signal when verification was unavailable", () => {
    expect(isBotFlagged(flag("provider_unavailable"))).toBe(false);
    expect(isBotFlagged(flag("gate_unavailable"))).toBe(false);
    expect(isBotFlagged(flag("secret_missing"))).toBe(false);
    expect(isBotFlagged(flag("challenge_error:timeout"))).toBe(false);
    expect(isBotFlagged(flag("challenge_error:frame_failed"))).toBe(false);
    expect(isBotFlagged(flag("challenge_error:200500"))).toBe(false);
  });

  it("is a bot signal when any flagging plugin saw the visitor fail", () => {
    expect(isBotFlagged(flag("provider_unavailable", "token_missing"))).toBe(true);
  });

  it("only matches whole codes", () => {
    expect(isVerificationUnavailable("challenge_error:timeout_x")).toBe(false);
    expect(isVerificationUnavailable("timeout")).toBe(false);
    expect(isVerificationUnavailable(42)).toBe(false);
  });
});
