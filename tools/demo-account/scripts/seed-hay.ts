/**
 * Seed the Hay.chat side of a Casa Aurora demo store: knowledge documents, playbooks, the
 * "Casa Aurora Assistant" agent and org settings (time zone, language, business hours, optional
 * Quick check). Safe to re-run: everything is matched by title/name and updated in place.
 *
 *   tsx tools/demo-account/scripts/seed-hay.ts --platform shopify|woocommerce|nuvemshop|all
 *     [--dry-run] [--draft] [--only settings,agent,docs,playbooks] [--quick-check on|off]
 *     [--target prod|local] [--org <id>]
 *
 * Auth (real env vars win over tools/demo-account/.env, then tools/hay-cli/.env):
 *   HAY_API_KEY (org API key) or HAY_EMAIL + HAY_PASSWORD; HAY_TARGET (local|prod), HAY_BASE_URL.
 *   Without HAY_API_KEY / HAY_BASE_URL the hay CLI's saved session is used as well (`hay login`).
 * Org per store: --org, else HAY_ORG_SHOPIFY / HAY_ORG_WOOCOMMERCE / HAY_ORG_NUVEMSHOP, else
 *   HAY_ORG_ID, else the hay CLI's current org. `--platform all` seeds every platform whose
 *   HAY_ORG_<PLATFORM> is set (all three in dry-run).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HayApi, HayApiError } from "../../hay-cli/src/api";
import { boolFlag, parseArgs, stringFlag, UsageError, type ParsedArgs } from "../../hay-cli/src/args";
import { buildCtx } from "../../hay-cli/src/commands";
import { BUILTIN_TARGETS, loadConfig, resolveTargetName } from "../../hay-cli/src/config";
import { loadEnv } from "./lib/data";
import type { Platform } from "./lib/types";
import { PLATFORMS } from "./hay/content";
import { seedHay, STEPS, type SeedReport, type Step } from "./hay/seed";
import { REPO_ROOT } from "./hay/tools";

const USAGE = `Usage: seed-hay --platform shopify|woocommerce|nuvemshop|all [--dry-run] [--draft]
  [--only settings,agent,docs,playbooks] [--quick-check on|off] [--target prod|local] [--org <id>]`;

const BOOLEAN_FLAGS = new Set(["dry-run", "draft", "help", "verbose"]);

export function orgEnvVar(platform: Platform): string {
  return `HAY_ORG_${platform.toUpperCase()}`;
}

/** --org, then HAY_ORG_<PLATFORM>, then HAY_ORG_ID. Undefined = the hay CLI's current org. */
export function resolveOrg(platform: Platform, flagOrg: string | undefined, env = process.env): string | undefined {
  return flagOrg || env[orgEnvVar(platform)] || env.HAY_ORG_ID || undefined;
}

export function resolvePlatforms(value: string | undefined, dryRun: boolean, env = process.env): Platform[] {
  if (!value) throw new UsageError("--platform is required");
  if (value === "all") {
    const platforms = dryRun ? PLATFORMS : PLATFORMS.filter((p) => env[orgEnvVar(p)]);
    if (platforms.length === 0) {
      throw new UsageError(`--platform all needs at least one of ${PLATFORMS.map(orgEnvVar).join(", ")}`);
    }
    return platforms;
  }
  if (!PLATFORMS.includes(value as Platform)) throw new UsageError(`Unknown --platform "${value}"`);
  return [value as Platform];
}

function parseSteps(value: string | undefined): Set<Step> {
  if (!value) return new Set(STEPS);
  const steps = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const step of steps) if (!STEPS.includes(step as Step)) throw new UsageError(`Unknown --only step "${step}"`);
  return new Set(steps as Step[]);
}

function parseQuickCheck(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value !== "on" && value !== "off") throw new UsageError("--quick-check must be on or off");
  return value === "on";
}

/** An API client for one org: env API key / base URL in memory, else the hay CLI's session. */
function buildApi(args: ParsedArgs, organizationId: string | undefined): { api: HayApi; org: string | undefined } {
  const target = resolveTargetName(stringFlag(args, "target"), loadConfig());
  const { HAY_API_KEY, HAY_BASE_URL, HAY_EMAIL, HAY_PASSWORD } = process.env;
  if (HAY_API_KEY || HAY_BASE_URL) {
    const baseUrl = HAY_BASE_URL || BUILTIN_TARGETS[target]?.baseUrl;
    if (!baseUrl) throw new UsageError(`Unknown target "${target}" and no HAY_BASE_URL`);
    // Tokens from a password login stay in memory; nothing is written to disk.
    const api = new HayApi({
      profile: { baseUrl, apiKey: HAY_API_KEY },
      organizationId,
      credentials: !HAY_API_KEY && HAY_EMAIL && HAY_PASSWORD ? { email: HAY_EMAIL, password: HAY_PASSWORD } : undefined,
    });
    return { api, org: organizationId };
  }
  const ctx = buildCtx({ ...args, flags: { ...args.flags, ...(organizationId && { org: organizationId }) } }, target);
  return { api: ctx.api, org: organizationId ?? ctx.profile.organizationId };
}

function printReport(platform: Platform, report: SeedReport): void {
  console.log(
    `${platform}: ${report.created.length} created, ${report.updated.length} updated, ${report.unchanged.length} unchanged`,
  );
  if (report.actionWarnings.length > 0) {
    console.log("Action warnings:");
    for (const warning of report.actionWarnings) console.log(`  - ${warning}`);
  } else {
    console.log("Action references: all resolve to a tool.");
  }
}

export async function run(argv: string[]): Promise<number> {
  loadEnv();
  const cliEnv = join(REPO_ROOT, "tools", "hay-cli", ".env");
  if (existsSync(cliEnv)) process.loadEnvFile(cliEnv);

  try {
    const args = parseArgs(argv, BOOLEAN_FLAGS);
    if (boolFlag(args, "help")) {
      console.log(USAGE);
      return 0;
    }
    const dryRun = boolFlag(args, "dry-run");
    const flagOrg = stringFlag(args, "org");
    const platforms = resolvePlatforms(stringFlag(args, "platform"), dryRun);
    if (flagOrg && platforms.length > 1) throw new UsageError("--org can't be combined with --platform all");
    const steps = parseSteps(stringFlag(args, "only"));
    const quickCheck = parseQuickCheck(stringFlag(args, "quick-check"));

    for (const platform of platforms) {
      let api: HayApi | null = null;
      let org = resolveOrg(platform, flagOrg);
      if (!dryRun) {
        ({ api, org } = buildApi(args, org));
        if (!api.hasAuth) throw new UsageError("No credentials: set HAY_API_KEY or HAY_EMAIL + HAY_PASSWORD, or run `hay login`");
        if (!org) throw new UsageError(`No organization for ${platform}: set ${orgEnvVar(platform)} or pass --org`);
      }
      console.log(`== ${platform}${org ? ` (org ${org})` : ""}${dryRun ? " [dry-run]" : ""}`);
      const report = await seedHay(api, {
        platform,
        dryRun,
        playbookStatus: boolFlag(args, "draft") ? "draft" : "active",
        steps,
        quickCheck,
      });
      printReport(platform, report);
    }
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    console.error(error instanceof HayApiError ? `Hay.chat API error: ${error.message}` : (error as Error).message);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
