import { describe, expect, it } from "vitest";
import { UsageError } from "../src/args";
import { planSeed, STORE_ENV } from "../src/demo";

const base = { dryRun: false, resetOrders: false, target: "local" };
const only =
  (...set: string[]) =>
  (names: string[]) =>
    names.every((n) => set.includes(n));

describe("planSeed", () => {
  it("all: runs the stores and orgs that have credentials, skips the rest", () => {
    const env = only(...STORE_ENV.woocommerce, "HAY_ORG_WOOCOMMERCE");
    const { steps, skipped } = planSeed("all", base, env);
    expect(steps.map((s) => s.label)).toEqual(["woocommerce store", "Hay.chat (woocommerce)"]);
    expect(skipped).toHaveLength(4);
  });

  it("a named store without credentials is an error, not a skip", () => {
    expect(() => planSeed("shopify", base, only())).toThrow(UsageError);
  });

  it("dry run needs no credentials and passes the flags through", () => {
    const { steps } = planSeed("nuvemshop", { ...base, dryRun: true, resetOrders: true }, only());
    expect(steps).toEqual([
      {
        label: "nuvemshop store",
        script: "seed-nuvemshop.ts",
        args: ["--dry-run", "--reset-orders"],
      },
      {
        label: "Hay.chat (nuvemshop)",
        script: "seed-hay.ts",
        args: ["--dry-run", "--target", "local", "--platform", "nuvemshop"],
      },
    ]);
  });

  it("--org seeds the Hay.chat side without per-platform org vars", () => {
    const { steps } = planSeed("hay", { ...base, org: "org-1" }, only());
    expect(steps.map((s) => s.args.at(-1))).toEqual(["shopify", "woocommerce", "nuvemshop"]);
    expect(steps[0].args).toContain("org-1");
  });

  it("rejects unknown targets", () => {
    expect(() => planSeed("magento", base, only())).toThrow(/unknown seed/);
  });
});
