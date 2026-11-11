/**
 * Every tool must carry a risk class (core holds unclassified tools as unknown
 * writes) and a label in both locales.
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const { createFakeServer } = require("./harness");
const { riskFor } = require("@hay/plugin-sdk/tool-risk");
const { registerTrackingTools } = require("../tools/tracking");
const toolRisk = require("../tool-risk");

describe("tool risk", () => {
  const server = createFakeServer();
  registerTrackingTools(server);
  const names = [...server.tools.keys()];

  it("classifies every registered tool as a read and lists no other tool", () => {
    expect(names.filter((n) => riskFor(n, toolRisk) === null)).toEqual([]);
    expect([...toolRisk.read, ...Object.keys(toolRisk.write)].sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(riskFor(name, toolRisk).annotations.readOnlyHint).toBe(true);
    }
  });

  it("has an i18n label for every tool in en and pt-BR", () => {
    for (const lang of ["en", "pt-BR"]) {
      const i18n = require(`../../i18n/${lang}.json`);
      expect(Object.keys(i18n.tools).sort()).toEqual([...names].sort());
      for (const name of names) {
        expect(i18n.tools[name].label).toBeTruthy();
        expect(i18n.tools[name].description).toBeTruthy();
      }
    }
  });
});
