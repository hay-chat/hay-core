import { describe, it, expect } from "vitest";
import {
  CATEGORY_META_KEY,
  CAP_ENFORCED_META_KEY,
  WRITE_CATEGORIES,
  riskFor,
  applyToolRisk,
  normalizeToolRiskSpec,
  withToolRisk,
} from "./index.cjs";
import type { ToolWriteCategory } from "../types/index.js";

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

describe("tool-risk declarations", () => {
  it("keeps the TypeScript category union in step with the helper", () => {
    const typed: Record<ToolWriteCategory, true> = {
      refund: true,
      cancel: true,
      discount: true,
      exchange: true,
      return: true,
      address_change: true,
      customer_update: true,
      note: true,
      destructive: true,
      other_write: true,
    };
    expect(Object.keys(typed).sort()).toEqual(Object.keys(WRITE_CATEGORIES).sort());
  });

  it("does not treat Object.prototype names as declared tools", () => {
    expect(riskFor("constructor", { read: [], write: {} })).toBeNull();
    expect(riskFor("toString", { write: {} })).toBeNull();
  });

  describe("normalizeToolRiskSpec", () => {
    it("fills in missing halves", () => {
      expect(normalizeToolRiskSpec(undefined)).toEqual({ read: [], write: {}, capped: [] });
      expect(normalizeToolRiskSpec({ read: ["a"] })).toEqual({
        read: ["a"],
        write: {},
        capped: [],
      });
    });

    it("accepts capped writes and rejects a capped tool that is not a write", () => {
      expect(normalizeToolRiskSpec(spec).capped).toEqual(["create_coupon"]);
      expect(() => normalizeToolRiskSpec({ read: ["x"], capped: ["x"] })).toThrow(
        /must also be declared in toolRisk.write/,
      );
      expect(() => normalizeToolRiskSpec({ capped: "x" })).toThrow();
    });

    it("rejects an unknown or inherited category", () => {
      expect(() => normalizeToolRiskSpec({ write: { pay: "payment" } })).toThrow(
        /Unknown tool category/,
      );
      expect(() => normalizeToolRiskSpec({ write: { pay: "toString" } })).toThrow(
        /Unknown tool category/,
      );
    });

    it("rejects a tool declared both read and write", () => {
      expect(() => normalizeToolRiskSpec({ read: ["x"], write: { x: "note" } })).toThrow(
        /both read and write/,
      );
    });

    it("rejects malformed shapes", () => {
      expect(() => normalizeToolRiskSpec({ read: "x" })).toThrow();
      expect(() => normalizeToolRiskSpec({ write: ["x"] })).toThrow();
    });
  });

  describe("withToolRisk", () => {
    const spec = { read: ["list_customers"], write: { create_refund: "refund" } };

    it("marks declared reads read-only and declared writes with their category", () => {
      const [read, write] = withToolRisk(
        [{ name: "list_customers" }, { name: "create_refund", annotations: { title: "Refund" } }],
        spec,
      );
      expect(read.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
      expect(write.annotations).toEqual({
        title: "Refund",
        readOnlyHint: false,
        destructiveHint: true,
      });
      expect(write._meta).toEqual({ [CATEGORY_META_KEY]: "refund" });
    });

    it("lets the declaration override the server's own annotations", () => {
      const [tool] = withToolRisk(
        [{ name: "create_refund", annotations: { readOnlyHint: true } }],
        spec,
      );
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool._meta[CATEGORY_META_KEY]).toBe("refund");
    });

    it("keeps an undeclared tool exactly as the server sent it", () => {
      const remoteRead = { name: "search_docs", annotations: { readOnlyHint: true } };
      const unknownWrite = { name: "delete_everything" };
      const out = withToolRisk([remoteRead, unknownWrite], spec);
      expect(out[0]).toBe(remoteRead);
      expect(out[1]).toBe(unknownWrite);
    });

    it("carries the capEnforced flag for capped writes", () => {
      const [tool] = withToolRisk([{ name: "create_coupon" }], {
        write: { create_coupon: "discount" },
        capped: ["create_coupon"],
      });
      expect(tool._meta).toEqual({
        [CATEGORY_META_KEY]: "discount",
        [CAP_ENFORCED_META_KEY]: true,
      });
    });

    it("is a no-op without a spec", () => {
      const tools = [{ name: "a" }];
      expect(withToolRisk(tools, undefined)).toEqual(tools);
    });
  });
});
