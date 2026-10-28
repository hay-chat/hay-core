/**
 * Every tool this server registers must carry a risk class, or Hay.chat core
 * treats it as an unknown write and holds it for approval.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createFakeServer } = require("./harness");
const { riskFor, CATEGORY_META_KEY, CAP_ENFORCED_META_KEY } = require("@hay/plugin-sdk/tool-risk");
const toolRisk = require("../tool-risk");

function registeredToolNames() {
  const server = createFakeServer();
  const toolsDir = path.join(__dirname, "..", "tools");
  for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith(".js"))) {
    const mod = require(path.join(toolsDir, file));
    for (const [key, fn] of Object.entries(mod)) {
      if (key.startsWith("register") && typeof fn === "function") fn(server);
    }
  }
  return [...server.tools.keys()];
}

describe("tool risk classification", () => {
  const names = registeredToolNames();

  it("classifies every registered tool", () => {
    const unclassified = names.filter((name) => riskFor(name, toolRisk) === null);
    expect(unclassified).toEqual([]);
  });

  it("lists no tool that is not registered", () => {
    const listed = [...toolRisk.read, ...Object.keys(toolRisk.write)];
    expect(listed.filter((name) => !names.includes(name))).toEqual([]);
  });

  it("flags the coupon tool as enforcing its own cap", () => {
    expect(toolRisk.capped).toEqual(["nuvemshop_create_coupon"]);
    expect(riskFor("nuvemshop_create_coupon", toolRisk)._meta[CAP_ENFORCED_META_KEY]).toBe(true);
  });

  it("marks writes with a category and reads as read-only", () => {
    for (const name of names) {
      const risk = riskFor(name, toolRisk);
      if (toolRisk.read.includes(name)) {
        expect(risk.annotations.readOnlyHint).toBe(true);
      } else {
        expect(risk.annotations.readOnlyHint).toBe(false);
        expect(typeof risk._meta[CATEGORY_META_KEY]).toBe("string");
      }
    }
  });
});
