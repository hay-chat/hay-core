import { suggestGraduation, type GraduationRow } from "../../services/core/approval-graduation";

const refunds = (amounts: number[], status: GraduationRow["status"] = "executed") =>
  amounts.map((amount) => ({ category: "refund", status, amount }));

describe("suggestGraduation (D4-11)", () => {
  it("suggests the largest approved amount once 5 of 5 were approved", () => {
    expect(suggestGraduation(refunds([10, 20, 15, 30, 25]), 0)).toEqual({
      category: "refund",
      approved: 5,
      total: 5,
      amount: 30,
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
      suggestGraduation([...base, { category: "refund", status: "approved", amount: null }], 0),
    ).toBeNull();
  });

  it("ignores pending requests and suggests nothing at or below today's amount", () => {
    const base = refunds([10, 20, 15, 30, 25]);
    expect(suggestGraduation([...base, ...refunds([500], "pending")], 0)?.amount).toBe(30);
    expect(suggestGraduation(base, 30)).toBeNull();
  });
});
