/**
 * Load Hay's own assistant content (knowledge documents, playbooks and, optionally, the assistant)
 * into the Hay.chat org that runs it. Reuses the Casa Aurora seed engine
 * (tools/demo-account/scripts/hay): documents and playbooks are matched by title and updated in
 * place, so it is safe to re-run.
 *
 *   tsx tools/hay-assistant/scripts/seed-hay-assistant.ts --org <id> [--dry-run] [--draft]
 *     [--only docs,playbooks,assistant] [--target prod|local]
 *
 * --org is required (there is no fallback org, so nothing can land in the wrong one). The default
 * steps are docs and playbooks; add `assistant` to --only to also replace the assistant's name,
 * tone, avoid list and instructions. A dry run needs no credentials and sends nothing.
 * Auth (live run): HAY_API_KEY (org API key) or HAY_EMAIL + HAY_PASSWORD, or the hay CLI's saved
 * session (`hay login`); see tools/demo-account/scripts/seed-hay.ts.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HayApiError } from "../../hay-cli/src/api";
import { boolFlag, parseArgs, stringFlag, UsageError } from "../../hay-cli/src/args";
import { loadEnv } from "../../demo-account/scripts/lib/data";
import { loadKnowledgeDir, loadPlaybooksDir } from "../../demo-account/scripts/hay/content";
import { applySeed, STEPS, type SeedContent, type Step } from "../../demo-account/scripts/hay/seed";
import { listToolsInDir, REPO_ROOT } from "../../demo-account/scripts/hay/tools";
import { buildApi } from "../../demo-account/scripts/seed-hay";
import { HAY_ASSISTANT } from "./assistant";

export const HAY_ASSISTANT_ROOT = join(__dirname, "..");
const CALCOM_PLUGIN_ID = "hay-plugin-calcom";
const CALCOM_MCP_DIR = join(REPO_ROOT, "plugins", "core", "calcom", "mcp");

const DEFAULT_STEPS: Step[] = ["docs", "playbooks"];
const USAGE = `Usage: seed-hay-assistant --org <id> [--dry-run] [--draft]
  [--only docs,playbooks,assistant] [--target prod|local]`;

/** The only plugin the playbooks use is Cal.com; its tool names are read from its MCP source. */
export function resolveHayAction(toolName: string): string {
  if (!listToolsInDir(CALCOM_MCP_DIR).includes(toolName))
    throw new Error(`{{action:${toolName}}} is not a Cal.com tool`);
  return CALCOM_PLUGIN_ID;
}

export function hayAssistantContent(root = HAY_ASSISTANT_ROOT): SeedContent {
  return {
    locale: "en",
    assistant: HAY_ASSISTANT,
    resolveAction: resolveHayAction,
    docs: loadKnowledgeDir(join(root, "knowledge"), "en"),
    playbooks: loadPlaybooksDir(join(root, "playbooks"), resolveHayAction),
    checkActions: (playbooks) => {
      const tools = new Set(listToolsInDir(CALCOM_MCP_DIR));
      return playbooks.flatMap((p) =>
        p.actions
          .filter((a) => !tools.has(a))
          .map((a) => `${p.file}: {{action:${a}}} is not a Cal.com tool`),
      );
    },
  };
}

export function parseSteps(value: string | undefined): Set<Step> {
  if (!value) return new Set(DEFAULT_STEPS);
  const steps = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const step of steps)
    if (!STEPS.includes(step as Step) || step === "settings")
      throw new UsageError(`Unknown --only step "${step}" (use docs, playbooks, assistant)`);
  return new Set(steps as Step[]);
}

export async function run(argv: string[]): Promise<number> {
  loadEnv();
  const cliEnv = join(REPO_ROOT, "tools", "hay-cli", ".env");
  if (existsSync(cliEnv)) process.loadEnvFile(cliEnv);
  try {
    const args = parseArgs(argv, new Set(["dry-run", "draft", "help", "verbose"]));
    if (boolFlag(args, "help")) {
      console.log(USAGE);
      return 0;
    }
    const org = stringFlag(args, "org");
    if (!org) throw new UsageError("--org is required");
    const dryRun = boolFlag(args, "dry-run");
    const steps = parseSteps(stringFlag(args, "only"));
    const api = dryRun ? null : buildApi(args, org).api;
    if (api && !api.hasAuth)
      throw new UsageError(
        "No credentials: set HAY_API_KEY or HAY_EMAIL + HAY_PASSWORD, or run `hay login`",
      );

    console.log(`== hay-assistant (org ${org})${dryRun ? " [dry-run]" : ""}`);
    const content = hayAssistantContent();
    const report = await applySeed(api, content, {
      dryRun,
      playbookStatus: boolFlag(args, "draft") ? "draft" : "active",
      steps,
    });
    console.log(
      `${report.created.length} created, ${report.updated.length} updated, ${report.unchanged.length} unchanged`,
    );
    for (const warning of report.actionWarnings) console.log(`  action warning: ${warning}`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return 2;
    }
    console.error(
      error instanceof HayApiError
        ? `Hay.chat API error: ${error.message}`
        : (error as Error).message,
    );
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
