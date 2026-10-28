import { describe, it, expect } from "vitest";
import { riskFor, applyToolRisk, CATEGORY_META_KEY, CAP_ENFORCED_META_KEY } from "./index.cjs";

const spec = {
  read: ["get_order"],
  write: { create_coupon: "discount", add_note: "note" },
  capped: ["create_coupon"],
};

describe("tool-risk", () => {
  it("marks reads read-only and writes with their category", () => {
    expect(riskFor("get_order", spec)).toEqual({
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(riskFor("add_note", spec)?._meta).toEqual({ [CATEGORY_META_KEY]: "note" });
    expect(riskFor("unknown", spec)).toBeNull();
  });

  it("flags capped tools as enforcing their own cap", () => {
    expect(riskFor("create_coupon", spec)?._meta).toEqual({
      [CATEGORY_META_KEY]: "discount",
      [CAP_ENFORCED_META_KEY]: true,
    });
  });

  it("merges risk into registerTool() configs over the tool's own annotations", () => {
    const seen: Record<string, { annotations?: unknown; _meta?: unknown }> = {};
    const server = applyToolRisk(
      {
        registerTool(name: string, config: { annotations?: unknown; _meta?: unknown }) {
          seen[name] = config;
        },
      },
      spec,
    );
    server.registerTool("add_note", {
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { other: 1 },
    });
    server.registerTool("unknown", { annotations: { readOnlyHint: false } });
    expect(seen.add_note).toEqual({
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: { other: 1, [CATEGORY_META_KEY]: "note" },
    });
    expect(seen.unknown).toEqual({ annotations: { readOnlyHint: false } });
  });
});
