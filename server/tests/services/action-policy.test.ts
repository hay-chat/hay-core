import { decideGate, extractAmount } from "../../services/core/action-policy";
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

describe("extractAmount", () => {
  it("returns null when any transaction amount is unreadable", () => {
    expect(extractAmount({ transactions: [{ amount: "1" }, { amount: "x" }] })).toBeNull();
    expect(extractAmount({ amount: -3 })).toBeNull();
    expect(extractAmount({})).toBeNull();
  });
});
