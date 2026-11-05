/**
 * `hay demo …`: seeds the Casa Aurora demo account (tools/demo-account) into the e-commerce
 * stores and Hay.chat. Each seed is a standalone script run with the repo's tsx; this module
 * picks which ones run from the store credentials in tools/demo-account/.env.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { boolFlag, stringFlag, UsageError } from "./args";
import type { CommandResult, Ctx } from "./commands";

const REPO = join(__dirname, "..", "..", "..");
const DEMO_DIR = join(REPO, "tools", "demo-account");
// tsx is a server dependency; npm hoists it to the root only sometimes (same lookup as bin/hay).
const TSX = [
  join(REPO, "node_modules", ".bin", "tsx"),
  join(REPO, "server", "node_modules", ".bin", "tsx"),
].find(existsSync);

export const DEMO_PLATFORMS = ["shopify", "woocommerce", "nuvemshop"] as const;
type DemoPlatform = (typeof DEMO_PLATFORMS)[number];

/** Env vars a store seed needs before it can write; `--dry-run` needs none. */
export const STORE_ENV: Record<DemoPlatform, string[]> = {
  shopify: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"],
  woocommerce: ["WOO_URL", "WOO_CONSUMER_KEY", "WOO_CONSUMER_SECRET"],
  nuvemshop: ["NUVEMSHOP_STORE_ID", "NUVEMSHOP_ACCESS_TOKEN"],
};

/** The Hay.chat org each store is connected to. */
export const HAY_ORG_ENV: Record<DemoPlatform, string> = {
  shopify: "HAY_ORG_SHOPIFY",
  woocommerce: "HAY_ORG_WOOCOMMERCE",
  nuvemshop: "HAY_ORG_NUVEMSHOP",
};

export interface SeedStep {
  label: string;
  script: string;
  args: string[];
}

function loadDemoEnv(): void {
  const file = join(DEMO_DIR, ".env");
  if (!existsSync(file)) return;
  // process.loadEnvFile keeps variables that are already set, so real env wins.
  process.loadEnvFile(file);
}

const hasEnv = (names: string[]) => names.every((name) => Boolean(process.env[name]));

/**
 * Which seed scripts to run for `hay demo seed <what>`. Store seeds come first so the Hay.chat
 * playbooks can be validated against plugins that already see the store's data.
 * Exported for tests.
 */
export function planSeed(
  what: string,
  options: {
    dryRun: boolean;
    resetOrders: boolean;
    imageBaseUrl?: string;
    currency?: string;
    target: string;
    org?: string;
  },
  env: (names: string[]) => boolean = hasEnv,
): { steps: SeedStep[]; skipped: string[] } {
  const all = what === "all";
  if (!all && what !== "hay" && !DEMO_PLATFORMS.includes(what as DemoPlatform)) {
    throw new UsageError(`unknown seed "${what}": use all, hay, ${DEMO_PLATFORMS.join(", ")}`);
  }
  const steps: SeedStep[] = [];
  const skipped: string[] = [];
  const common = [...(options.dryRun ? ["--dry-run"] : [])];
  const storeArgs = [
    ...common,
    ...(options.resetOrders ? ["--reset-orders"] : []),
    ...(options.imageBaseUrl ? ["--image-base-url", options.imageBaseUrl] : []),
  ];

  for (const platform of DEMO_PLATFORMS) {
    if (!all && what !== platform) continue;
    if (!options.dryRun && !env(STORE_ENV[platform])) {
      if (!all)
        throw new UsageError(
          `${platform}: set ${STORE_ENV[platform].join(", ")} in tools/demo-account/.env`,
        );
      skipped.push(`${platform} store (no ${STORE_ENV[platform].join(" / ")})`);
      continue;
    }
    steps.push({
      label: `${platform} store`,
      script: `seed-${platform}.ts`,
      args: [
        ...storeArgs,
        ...(platform === "shopify" && options.currency ? ["--currency", options.currency] : []),
      ],
    });
  }

  const hayArgs = [
    ...common,
    "--target",
    options.target,
    ...(options.org ? ["--org", options.org] : []),
  ];
  if (what === "hay" || all) {
    for (const platform of DEMO_PLATFORMS) {
      if (!options.org && !options.dryRun && !env([HAY_ORG_ENV[platform]])) {
        skipped.push(`Hay.chat ${platform} org (no ${HAY_ORG_ENV[platform]})`);
        continue;
      }
      steps.push({
        label: `Hay.chat (${platform})`,
        script: "seed-hay.ts",
        args: [...hayArgs, "--platform", platform],
      });
    }
  } else {
    // A single store also gets its Hay.chat org seeded, when one is configured.
    const platform = what as DemoPlatform;
    if (options.org || options.dryRun || env([HAY_ORG_ENV[platform]])) {
      steps.push({
        label: `Hay.chat (${platform})`,
        script: "seed-hay.ts",
        args: [...hayArgs, "--platform", platform],
      });
    } else {
      skipped.push(`Hay.chat ${platform} org (no ${HAY_ORG_ENV[platform]})`);
    }
  }
  return { steps, skipped };
}

function runScript(script: string, args: string[]): number {
  if (!TSX) {
    console.error(`hay: tsx not found; run npm install in ${REPO}`);
    return 1;
  }
  const result = spawnSync(TSX, [join(DEMO_DIR, "scripts", script), ...args], {
    cwd: REPO,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

export async function demoSeed(ctx: Ctx): Promise<CommandResult> {
  loadDemoEnv();
  const what = ctx.args.positionals[2] ?? "all";
  const { steps, skipped } = planSeed(what, {
    dryRun: boolFlag(ctx.args, "dry-run"),
    resetOrders: boolFlag(ctx.args, "reset-orders"),
    imageBaseUrl: stringFlag(ctx.args, "image-base-url"),
    currency: stringFlag(ctx.args, "currency"),
    target: ctx.target,
    org: stringFlag(ctx.args, "org"),
  });
  if (steps.length === 0) {
    throw new UsageError(
      `nothing to seed: ${skipped.join("; ")}. See tools/demo-account/README.md`,
    );
  }
  const results: { step: string; ok: boolean }[] = [];
  for (const step of steps) {
    console.error(`\n== ${step.label}`);
    const ok = runScript(step.script, step.args) === 0;
    results.push({ step: step.label, ok });
    if (!ok) break;
  }
  const failed = results.some((r) => !r.ok);
  return {
    data: { results, skipped },
    text: [
      "",
      ...results.map((r) => `${r.ok ? "ok    " : "FAILED"} ${r.step}`),
      ...skipped.map((s) => `skip   ${s}`),
    ],
    exitCode: failed ? 1 : 0,
  };
}

export async function demoImages(_ctx: Ctx): Promise<CommandResult> {
  const code = runScript("generate-images.ts", []);
  return {
    data: { ok: code === 0 },
    text: [
      code === 0
        ? "images written to tools/demo-account/catalog/images"
        : "image generation failed",
    ],
    exitCode: code === 0 ? 0 : 1,
  };
}
