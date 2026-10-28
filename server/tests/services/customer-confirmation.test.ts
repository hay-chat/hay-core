import {
  findConfirmation,
  needsCustomerConfirmation,
  sameRequest,
} from "@server/services/core/customer-confirmation";

const write = (category: string) => ({ readOnly: false, category, classified: true }) as never;

describe("needsCustomerConfirmation (D4-10)", () => {
  it("asks for every write when on, never for reads", () => {
    expect(needsCustomerConfirmation(write("refund"), { customerConfirmation: true })).toBe(true);
    expect(needsCustomerConfirmation(write("other_write"), { customerConfirmation: true })).toBe(
      true,
    );
    expect(needsCustomerConfirmation(write("note"), { customerConfirmation: true })).toBe(true);
    expect(
      needsCustomerConfirmation({ readOnly: true } as never, { customerConfirmation: true }),
    ).toBe(false);
  });

  it("forces cancels on even when switched off", () => {
    expect(needsCustomerConfirmation(write("refund"), { customerConfirmation: false })).toBe(false);
    expect(needsCustomerConfirmation(write("cancel"), { customerConfirmation: false })).toBe(true);
  });
});

describe("sameRequest", () => {
  const asked = { order_id: "1", transactions: [{ parentId: "t", amount: "30.00" }] };

  it("accepts the same args in any key order and a lower amount", () => {
    expect(sameRequest({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
    expect(
      sameRequest(asked, { order_id: "1", transactions: [{ parentId: "t", amount: "20.00" }] }),
    ).toBe(true);
  });

  it("rejects a higher amount or a different order", () => {
    expect(
      sameRequest(asked, { order_id: "1", transactions: [{ parentId: "t", amount: "31.00" }] }),
    ).toBe(false);
    expect(sameRequest(asked, { ...asked, order_id: "2" })).toBe(false);
  });
});

describe("findConfirmation", () => {
  const ask = (id: string, used = false) => ({
    id,
    type: "Tool",
    metadata: {
      toolName: "t",
      toolInput: { a: 1 },
      toolStatus: "NEEDS_CONFIRMATION",
      confirmationUsed: used,
    },
  });
  const customer = { id: "c", type: "Customer" };

  it("only counts the newest unused ask, with a customer message after it", () => {
    expect(findConfirmation([customer, ask("x")], "t", { a: 1 })?.id).toBe("x");
    expect(findConfirmation([ask("y"), customer, ask("x")], "t", { a: 1 })).toBeNull();
    expect(findConfirmation([customer, ask("x", true)], "t", { a: 1 })).toBeNull();
    expect(findConfirmation([customer, ask("x")], "other", { a: 1 })).toBeNull();
  });

  it("only counts in the turn that answers the question", () => {
    const bot = { id: "b", type: "BotAgent" };
    // Same-turn interim message, then the shopper's answer to the question.
    expect(findConfirmation([bot, customer, bot, ask("x")], "t", { a: 1 })?.id).toBe("x");
    // The shopper answered, the AI replied, the chat moved on: not a yes any more.
    expect(findConfirmation([customer, bot, customer, bot, ask("x")], "t", { a: 1 })).toBeNull();
  });
});
