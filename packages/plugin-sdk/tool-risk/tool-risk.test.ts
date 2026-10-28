import { describe, it, expect } from "vitest";
import {
  CATEGORY_META_KEY,
  WRITE_CATEGORIES,
  riskFor,
  normalizeToolRiskSpec,
  withToolRisk,
} from "./index.cjs";
import type { ToolWriteCategory } from "../types/index.js";

describe("tool-risk", () => {
  it("keeps the TypeScript category union in step with the helper", () => {
    const typed: Record<ToolWriteCategory, true> = {
      refund: true,
      cancel: true,
      discount: true,
      return: true,
      address_change: true,
      customer_update: true,
      note: true,
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
      expect(normalizeToolRiskSpec(undefined)).toEqual({ read: [], write: {} });
      expect(normalizeToolRiskSpec({ read: ["a"] })).toEqual({ read: ["a"], write: {} });
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

    it("is a no-op without a spec", () => {
      const tools = [{ name: "a" }];
      expect(withToolRisk(tools, undefined)).toEqual(tools);
    });
  });
});
