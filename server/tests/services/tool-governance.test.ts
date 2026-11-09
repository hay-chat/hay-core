/**
 * Pure pieces of tool governance: the verified customer a conversation is
 * with, the stable key that makes two approval requests the same, the
 * playbook's tool list, and the customer-data risk flag.
 */
jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/core/core-tools", () => ({
  coreToolRegistry: { has: (name: string) => name === "create_ticket" },
}));

import { identityFromCustomer } from "@server/services/core/customer-identity";
import { requestKey } from "@server/services/pending-action.service";
import { isToolEnabled } from "@server/services/core/enabled-tools";
import { classifyTool } from "@server/services/core/tool-risk";
import type { Customer } from "@server/database/entities/customer.entity";

function customer(fields: Partial<Customer>): Customer {
  return {
    external_id: null,
    email: null,
    phone: null,
    external_metadata: null,
    ...fields,
  } as Customer;
}

describe("identityFromCustomer", () => {
  it("verifies a web customer only when the store signed its external id", () => {
    expect(identityFromCustomer(customer({ email: "ana@example.com" }), "web")).toEqual({
      trust: "none",
    });
    expect(
      identityFromCustomer(
        customer({ external_id: "c-1", email: "ana@example.com" }),
        "web",
        "webchat_signature",
      ),
    ).toEqual({
      trust: "verified",
      source: "webchat_signature",
      externalId: "c-1",
      email: "ana@example.com",
      phone: null,
    });
  });

  it("leaves out an email the shopper typed at hand-off", () => {
    const typed = customer({
      external_id: "c-1",
      email: "someone@else.com",
      external_metadata: { web: { emailConsentSource: "handoff" } },
    });
    expect(identityFromCustomer(typed, "web", "webchat_signature")).toMatchObject({
      trust: "verified",
      email: null,
    });
  });

  it("does not verify a store customer the signature did not link", () => {
    const store = customer({ external_id: "c-1", email: "ana@example.com" });
    expect(identityFromCustomer(store, "web", "prechat_email")).toEqual({ trust: "none" });
    expect(identityFromCustomer(store, "web")).toEqual({ trust: "none" });
  });

  it("takes a channel conversation's identity from what the channel stored, not the record", () => {
    const sender = customer({
      external_id: "+5511987654321",
      email: "typed@example.com",
      external_metadata: { whatsapp: { phone: "+5511987654321" } },
    });
    expect(identityFromCustomer(sender, "whatsapp")).toEqual({
      trust: "verified",
      source: "channel",
      externalId: "+5511987654321",
      email: null,
      phone: "+5511987654321",
    });
    expect(identityFromCustomer(sender, "email")).toEqual({ trust: "none" });
  });
});

describe("requestKey", () => {
  it("is the same for a reworded request on the same order and amount", () => {
    expect(requestKey({ order_id: "1001", amount: "25.00", reason: "damaged" })).toBe(
      requestKey({ order_id: "1001", amount: 25, reason: "the item arrived damaged" }),
    );
  });

  it("differs for another order or another amount", () => {
    const key = requestKey({ order_id: "1001", amount: 25 });
    expect(requestKey({ order_id: "1002", amount: 25 })).not.toBe(key);
    expect(requestKey({ order_id: "1001", amount: 30 })).not.toBe(key);
  });

  it("falls back to all args when a call names no record and no amount", () => {
    expect(requestKey({ note: "a" })).not.toBe(requestKey({ note: "b" }));
    expect(requestKey({ b: 1, a: 2 })).toBe(requestKey({ a: 2, b: 1 }));
  });
});

describe("isToolEnabled", () => {
  it("allows every tool without a playbook list", async () => {
    expect(await isToolEnabled({ enabled_tools: null }, "shop:create_refund")).toBe(true);
  });

  it("allows only listed tools, plus core and page tools", async () => {
    const conversation = { enabled_tools: ["shop:get_order"] };
    expect(await isToolEnabled(conversation, "shop:get_order")).toBe(true);
    expect(await isToolEnabled(conversation, "shop:create_refund")).toBe(false);
    expect(await isToolEnabled(conversation, "create_ticket")).toBe(true);
  });
});

describe("classifyTool customer data", () => {
  it("marks a read that declares customer data", () => {
    expect(
      classifyTool({
        annotations: { readOnlyHint: true },
        _meta: { "chat.hay/customerData": true },
      }),
    ).toEqual({ readOnly: true, category: null, classified: true, customerData: true });
    expect(classifyTool({ annotations: { readOnlyHint: true } })).not.toHaveProperty(
      "customerData",
    );
  });
});
