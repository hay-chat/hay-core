import { classifyTool, MONEY_CATEGORIES } from "../../services/core/tool-risk";

describe("classifyTool", () => {
  it("treats readOnlyHint=true as a read", () => {
    expect(classifyTool({ annotations: { readOnlyHint: true } })).toEqual({
      readOnly: true,
      category: null,
      classified: true,
    });
  });

  it("reads the Hay.chat write category from _meta", () => {
    expect(
      classifyTool({
        annotations: { readOnlyHint: false, destructiveHint: true },
        _meta: { "chat.hay/category": "refund" },
      }),
    ).toEqual({ readOnly: false, category: "refund", classified: true });
  });

  it("falls back to an unclassified write when nothing is declared", () => {
    expect(classifyTool({})).toEqual({
      readOnly: false,
      category: "other_write",
      classified: false,
    });
    expect(classifyTool(null).readOnly).toBe(false);
  });

  it("treats an unknown category or readOnlyHint=false without category as unclassified", () => {
    expect(classifyTool({ _meta: { "chat.hay/category": "teleport" } }).classified).toBe(false);
    expect(classifyTool({ annotations: { readOnlyHint: false } }).classified).toBe(false);
  });

  it("counts refund, cancel and discount as money moves", () => {
    expect([...MONEY_CATEGORIES].sort()).toEqual(["cancel", "discount", "refund"]);
  });
});
