import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/config/env", () => ({ config: { domain: { api: "api.hay.chat:443" } } }));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/repositories/conversation.repository", () => ({ conversationRepository: {} }));
jest.mock("@server/services/dpop-cache.service", () => ({ dpopCacheService: {} }));

import {
  proofClaimsError,
  publicConversationProofTarget,
  socketIdentifyProofTarget,
} from "@server/services/webchat/dpop-proof.service";

const NOW = 1_800_000_000;
const target = publicConversationProofTarget("sendMessage", "chat.selfhosted.test:8443");
const claims = {
  htm: "POST",
  htu: "https://api.hay.chat/v1/publicConversations.sendMessage",
  iat: NOW,
  jti: "jti-1",
};

describe("proofClaimsError", () => {
  it.each([
    ["the API domain", claims.htu],
    ["the request's host", "https://chat.selfhosted.test:8443/v1/publicConversations.sendMessage"],
  ])("accepts a proof signed for %s", (_name, htu) => {
    expect(proofClaimsError({ ...claims, htu }, target, NOW)).toBeNull();
  });

  it.each([
    ["another procedure", "https://api.hay.chat/v1/publicConversations.getMessages"],
    ["another host", "https://elsewhere.test/v1/publicConversations.sendMessage"],
    ["another scheme", "wss://api.hay.chat/v1/publicConversations.sendMessage"],
    ["no url at all", undefined],
  ])("refuses a proof signed for %s", (_name, htu) => {
    expect(proofClaimsError({ ...claims, htu }, target, NOW)).toBe("URL mismatch");
  });

  it("refuses another method", () => {
    expect(proofClaimsError({ ...claims, htm: "GET" }, target, NOW)).toBe("HTTP method mismatch");
  });

  it.each([[undefined], ["1800000000"], [Number.NaN]])("refuses an iat of %p", (iat) => {
    expect(proofClaimsError({ ...claims, iat }, target, NOW)).toBe("Missing issued-at time");
  });

  it("refuses a proof outside the time window", () => {
    expect(proofClaimsError({ ...claims, iat: NOW - 121 }, target, NOW)).toBe(
      "Token outside time window",
    );
  });

  it.each([[undefined], [""], [7], ["x".repeat(129)]])("refuses a jti of %p", (jti) => {
    expect(proofClaimsError({ ...claims, jti }, target, NOW)).toBe("Invalid JTI");
  });

  it("binds a socket identify to GET /ws over a socket scheme", () => {
    const socket = socketIdentifyProofTarget(undefined);
    const identify = { ...claims, htm: "GET", htu: "wss://api.hay.chat/ws" };
    expect(proofClaimsError(identify, socket, NOW)).toBeNull();
    expect(proofClaimsError(claims, socket, NOW)).toBe("HTTP method mismatch");
  });
});

describe("dpop proof runtime dependency", () => {
  // The verifier loads this package through a dynamic import that typecheck cannot see.
  it("keeps the JWT library installed", () => {
    expect(() => require.resolve("jose")).not.toThrow();
  });
});
