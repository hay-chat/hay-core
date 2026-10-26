import { describe, expect, it } from "vitest";
import {
  conversationIdFromRecipients,
  ingestAlias,
  isHayMessageId,
  outboundMessageId,
  replySubject,
  threadRootId,
  tokenAddress,
} from "./thread.js";

const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

describe("ingestAlias", () => {
  it("is deterministic per org and lowercases the domain", () => {
    const a = ingestAlias("org-1", "Inbound.Hay.Chat");
    expect(a).toBe(ingestAlias("org-1", "inbound.hay.chat"));
    expect(a).toMatch(/^in-[0-9a-f]{10}@inbound\.hay\.chat$/);
    expect(a).not.toBe(ingestAlias("org-2", "inbound.hay.chat"));
  });
});

describe("token addresses", () => {
  const alias = "in-abc123def4@inbound.hay.chat";

  it("round-trips the conversation id through a +c sub-address", () => {
    const address = tokenAddress(alias, CONVERSATION_ID);
    expect(address).toBe(`in-abc123def4+c${CONVERSATION_ID}@inbound.hay.chat`);
    expect(conversationIdFromRecipients(["support@acme.com", address.toUpperCase()], alias)).toBe(
      CONVERSATION_ID,
    );
  });

  it("ignores other sub-addresses and other aliases", () => {
    expect(
      conversationIdFromRecipients(["in-abc123def4+news@inbound.hay.chat"], alias),
    ).toBeUndefined();
    expect(
      conversationIdFromRecipients([`in-other+c${CONVERSATION_ID}@inbound.hay.chat`], alias),
    ).toBeUndefined();
  });
});

describe("threadRootId", () => {
  it("prefers the first reference, then in-reply-to, then the message id", () => {
    expect(
      threadRootId({ messageId: "<m>", inReplyTo: "<r>", references: ["<root>", "<r>"] }),
    ).toBe("<root>");
    expect(threadRootId({ messageId: "<m>", inReplyTo: "<r>", references: [] })).toBe("<r>");
    expect(threadRootId({ messageId: "<m>", references: [] })).toBe("<m>");
  });
});

describe("outbound ids and subjects", () => {
  it("stamps hay ids and recognises them", () => {
    const id = outboundMessageId("msg-1", "updates.hay.chat");
    expect(id).toBe("<hay-msg-1@updates.hay.chat>");
    expect(isHayMessageId(id)).toBe(true);
    expect(isHayMessageId("<abc@shopper.com>")).toBe(false);
  });

  it("prefixes Re: once", () => {
    expect(replySubject("Where is my order?", "fallback")).toBe("Re: Where is my order?");
    expect(replySubject("RE: Where is my order?", "fallback")).toBe("RE: Where is my order?");
    expect(replySubject("  ", "Your conversation with Acme")).toBe(
      "Re: Your conversation with Acme",
    );
  });
});
