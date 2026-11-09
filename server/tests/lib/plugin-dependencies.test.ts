import { describe, it, expect } from "@jest/globals";
import { assertRegistryDependencies } from "@server/lib/plugin-dependencies";

const SDK = "/repo/packages/plugin-sdk";
const DIR = "/repo/plugins/org/my-plugin";
const check = (manifest: Record<string, unknown>) =>
  assertRegistryDependencies(manifest, DIR, SDK);

describe("assertRegistryDependencies", () => {
  it("accepts versions, ranges and tags", () => {
    expect(() =>
      check({ dependencies: { a: "1.2.3", b: "^2.0.0", c: ">=1 <3 || 4.x", d: "latest" } }),
    ).not.toThrow();
  });

  it("accepts the SDK only at its real location", () => {
    const local = { dependencies: { "@hay/plugin-sdk": "file:../../../packages/plugin-sdk" } };
    expect(() => check(local)).not.toThrow();
    expect(() => check({ dependencies: { "@hay/plugin-sdk": "file:../evil" } })).toThrow();
  });

  it.each([
    "git+https://example.com/repo.git",
    "https://example.com/pkg.tgz",
    "file:../other",
    "user/repo",
    "npm:other@1.0.0",
  ])("refuses %s in every dependency field", (spec) => {
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      expect(() => check({ [field]: { a: spec } })).toThrow(/npm registry/);
    }
  });

  it("refuses overrides", () => {
    expect(() => check({ overrides: { a: "git+https://example.com/a.git" } })).toThrow(/overrides/);
  });
});
