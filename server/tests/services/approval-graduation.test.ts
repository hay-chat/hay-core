import { suggestGraduation, type GraduationRow } from "../../services/core/approval-graduation";

const refunds = (
  amounts: number[],
  status: GraduationRow["status"] = "executed",
  currency: string | null = "BRL",
) => amounts.map((amount) => ({ category: "refund", status, amount, currency }));

describe("suggestGraduation (D4-11)", () => {
  it("suggests the largest approved amount once 5 of 5 were approved", () => {
    expect(suggestGraduation(refunds([10, 20, 15, 30, 25]), 0)).toEqual({
      category: "refund",
      approved: 5,
      total: 5,
      amount: 30,
      currency: "BRL",
    });
  });

  it("needs at least 5 decisions", () => {
    expect(suggestGraduation(refunds([10, 20, 15, 30]), 0)).toBeNull();
  });

  it("says nothing after a single decline, expiry or a request without an amount", () => {
    const base = refunds([10, 20, 15, 30, 25]);
    expect(suggestGraduation([...base, ...refunds([5], "rejected")], 0)).toBeNull();
    expect(suggestGraduation([...base, ...refunds([5], "expired")], 0)).toBeNull();
    expect(
      suggestGraduation(
        [...base, { category: "refund", status: "approved", amount: null, currency: "BRL" }],
        0,
      ),
    ).toBeNull();
  });

  it("ignores pending requests and suggests nothing at or below today's amount", () => {
    const base = refunds([10, 20, 15, 30, 25]);
    expect(suggestGraduation([...base, ...refunds([500], "pending")], 0)?.amount).toBe(30);
    expect(suggestGraduation(base, 30)).toBeNull();
  });

  it("compares calls without a currency together, but never mixes currencies", () => {
    expect(suggestGraduation(refunds([10, 20, 15, 30, 25], "executed", null), 0)).toMatchObject({
      amount: 30,
      currency: null,
    });
    const mixed = [...refunds([10, 20, 15, 30]), ...refunds([2500], "executed", "USD")];
    expect(suggestGraduation(mixed, 0)).toBeNull();
    const partly = [...refunds([10, 20, 15, 30]), ...refunds([25], "executed", null)];
    expect(suggestGraduation(partly, 0)).toBeNull();
  });
});
