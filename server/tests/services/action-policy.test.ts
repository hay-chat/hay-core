import {
  decideGate,
  extractAmount,
  loosensActionApproval,
  lowerAmount,
  amountEditable,
} from "../../services/core/action-policy";
import { DEFAULT_ACTION_APPROVAL_CONFIG } from "../../types/organization-settings.types";
import { classifyTool, type ToolRisk } from "../../services/core/tool-risk";

const ON = { moneyMovesNeedApproval: true, thresholdAmount: 0 };
const risk = (category: string): ToolRisk =>
  classifyTool({ annotations: { readOnlyHint: false }, _meta: { "chat.hay/category": category } });
const READ = classifyTool({ annotations: { readOnlyHint: true } });
const UNKNOWN = classifyTool({});

describe("decideGate", () => {
  it("lets reads through", () => {
    expect(decideGate(READ, {}, ON)).toEqual({ kind: "allow" });
  });

  it("holds every refund at the default threshold of 0", () => {
    expect(decideGate(risk("refund"), { amount: "5.00" }, ON)).toEqual({
      kind: "hold",
      reason: "money_move",
      amount: 5,
    });
  });

  it("holds money moves above the threshold and lets smaller ones run", () => {
    const config = { moneyMovesNeedApproval: true, thresholdAmount: 50 };
    expect(decideGate(risk("refund"), { amount: 49.99 }, config)).toEqual({ kind: "allow" });
    expect(decideGate(risk("refund"), { amount: 50 }, config)).toEqual({ kind: "allow" });
    expect(decideGate(risk("discount"), { amount: "50.01" }, config).kind).toBe("hold");
    expect(
      decideGate(
        risk("refund"),
        { transactions: [{ amount: "30.00" }, { amount: "30.00" }] },
        config,
      ),
    ).toMatchObject({ kind: "hold", amount: 60 });
  });

  it("holds a money move whose amount is unknown, so cancels are always held", () => {
    const config = { moneyMovesNeedApproval: true, thresholdAmount: 1000 };
    expect(decideGate(risk("cancel"), { order_id: "1" }, config)).toEqual({
      kind: "hold",
      reason: "money_move",
      amount: null,
    });
  });

  it("holds unclassified tools as writes", () => {
    expect(decideGate(UNKNOWN, { anything: 1 }, ON)).toMatchObject({
      kind: "hold",
      reason: "unclassified_write",
    });
  });

  it("lets other classified writes run", () => {
    for (const category of ["address_change", "note", "return", "customer_update"]) {
      expect(decideGate(risk(category), {}, ON)).toEqual({ kind: "allow" });
    }
  });

  it("lets a cap-enforcing money tool run: the plugin itself refuses above its cap", () => {
    const capped = classifyTool({
      annotations: { readOnlyHint: false },
      _meta: { "chat.hay/category": "discount", "chat.hay/capEnforced": true },
    });
    expect(decideGate(capped, { type: "percentage", value: 10 }, ON)).toEqual({ kind: "allow" });
    expect(decideGate(risk("discount"), { type: "percentage", value: 10 }, ON).kind).toBe("hold");
  });

  it("allows everything when the owner turned the setting off", () => {
    const off = { moneyMovesNeedApproval: false, thresholdAmount: 0 };
    expect(decideGate(risk("refund"), { amount: 999 }, off)).toEqual({ kind: "allow" });
    expect(decideGate(risk("cancel"), {}, off)).toEqual({ kind: "allow" });
    expect(decideGate(UNKNOWN, {}, off)).toEqual({ kind: "allow" });
  });
});

describe("decideGate per-category and playbook policy (D4-9)", () => {
  it("applies the threshold only to refunds and discounts", () => {
    const config = { moneyMovesNeedApproval: true, thresholdAmount: 100 };
    expect(decideGate(risk("refund"), { amount: 10 }, config)).toEqual({ kind: "allow" });
    expect(decideGate(risk("exchange"), { amount: 10 }, config)).toMatchObject({
      kind: "hold",
      reason: "money_move",
    });
  });

  it("holds a non-money category the org switched on, and runs a money one it switched off", () => {
    const config = { ...ON, categories: { address_change: true, refund: false } };
    expect(decideGate(risk("address_change"), {}, config)).toEqual({
      kind: "hold",
      reason: "category_policy",
      amount: null,
    });
    expect(decideGate(risk("refund"), { amount: 999 }, config)).toEqual({ kind: "allow" });
    expect(decideGate(risk("cancel"), {}, config).kind).toBe("hold");
  });

  it("a playbook can only tighten: it holds even under the threshold, a cap, or approval off", () => {
    const loose = { moneyMovesNeedApproval: false, thresholdAmount: 1000 };
    expect(decideGate(risk("refund"), { amount: 5 }, loose, ["refund"])).toEqual({
      kind: "hold",
      reason: "playbook_policy",
      amount: 5,
    });
    const capped = classifyTool({
      annotations: { readOnlyHint: false },
      _meta: { "chat.hay/category": "discount", "chat.hay/capEnforced": true },
    });
    expect(decideGate(capped, {}, ON, ["discount"]).kind).toBe("hold");
    // Listing a category the org already holds changes nothing for others.
    expect(decideGate(risk("note"), {}, ON, ["refund"])).toEqual({ kind: "allow" });
  });
});

describe("loosensActionApproval", () => {
  const current = DEFAULT_ACTION_APPROVAL_CONFIG;
  it("flags switching approval off, raising the amount and changing approvers", () => {
    expect(loosensActionApproval(current, { moneyMovesNeedApproval: false })).toBe(true);
    expect(loosensActionApproval(current, { customerConfirmation: false })).toBe(true);
    expect(loosensActionApproval(current, { thresholdAmount: 10 })).toBe(true);
    expect(loosensActionApproval(current, { approverRoles: ["admin"] })).toBe(true);
    expect(loosensActionApproval(current, { categories: { cancel: false } })).toBe(true);
  });

  it("does not flag tightening or no-op changes", () => {
    expect(loosensActionApproval(current, { categories: { note: true } })).toBe(false);
    expect(loosensActionApproval(current, { categories: { note: false } })).toBe(false);
    expect(loosensActionApproval(current, { thresholdAmount: 0 })).toBe(false);
    expect(loosensActionApproval(current, { moneyMovesNeedApproval: true })).toBe(false);
  });
});

describe("extractAmount", () => {
  it("returns null when any transaction amount is unreadable", () => {
    expect(extractAmount({ transactions: [{ amount: "1" }, { amount: "x" }] })).toBeNull();
    expect(extractAmount({ amount: -3 })).toBeNull();
    expect(extractAmount({})).toBeNull();
  });
});

describe("lowerAmount (D4-6)", () => {
  it("lowers a top-level amount and keeps its type", () => {
    expect(lowerAmount({ amount: "25.00", currency: "BRL" }, 10)).toEqual({
      amount: "10.00",
      currency: "BRL",
    });
    expect(lowerAmount({ amount: 25, currency: "usd" }, 9.999)).toEqual({
      amount: 10,
      currency: "usd",
    });
  });

  it("lowers a single transaction", () => {
    expect(
      lowerAmount({ transactions: [{ parentId: "t", amount: "30.00", currency: "BRL" }] }, 12.5),
    ).toEqual({
      transactions: [{ parentId: "t", amount: "12.50", currency: "BRL" }],
    });
  });

  it("refuses up, zero, split refunds and calls without an amount", () => {
    expect(lowerAmount({ amount: "25.00", currency: "BRL" }, 25.01)).toBeNull();
    expect(lowerAmount({ amount: "25.00", currency: "BRL" }, 0)).toBeNull();
    expect(
      lowerAmount({ transactions: [{ amount: "10" }, { amount: "5" }] }, 4),
    ).toBeNull();
    expect(lowerAmount({ order_id: "1" }, 4)).toBeNull();
    expect(amountEditable({ order_id: "1" })).toBe(false);
  });

  it("refuses a call that does not state its currency (unknown unit, e.g. cents)", () => {
    expect(amountEditable({ amount: 2500 })).toBe(false);
    expect(lowerAmount({ amount: 2500 }, 1000)).toBeNull();
  });
});
