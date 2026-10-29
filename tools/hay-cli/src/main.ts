/**
 * hay: internal CLI for testing chat, conversations, plugins and server logs
 * against a Hay backend without a browser. See tools/hay-cli/README.md.
 */
import { HayApiError } from "./api";
import { boolFlag, parseArgs, stringFlag, UsageError } from "./args";
import {
  buildCtx,
  chatSend,
  convList,
  convShow,
  login,
  logout,
  logs,
  orgs,
  pluginsCall,
  pluginsList,
  pluginsTest,
  pluginsTools,
  use,
  whoami,
  type CommandResult,
  type Ctx,
} from "./commands";
import { configDir, loadConfig, resolveTargetName } from "./config";

const HELP = `hay - Hay backend test CLI

Usage: hay <command> [options]   (global: --target prod|local, --org <id>, --json, --verbose)

  login --email <e>               password from HAY_PASSWORD or stdin
  logout | whoami
  orgs                            organizations of the logged-in user (* = current)
  use <org id|slug|name>          set the current organization for the target
  chat send "<msg>"               post as a webchat customer, wait for the reply
        [--conversation <id>] [--no-wait] [--timeout 90s] [--logs] [--lang pt-BR]
  conv list [--status open] [--limit 20] [--page 1]
  conv show <id> [--limit 200] [--logs]
  logs [<conversationId>] [--since 15m] [--log-limit 300]
  plugins list [--all] | tools [<plugin>] | test <plugin> | call (not available)

Target: --target, else HAY_TARGET, else config defaultTarget, else prod.
Config: ${configDir()}/config.json
Exit codes: 0 ok, 1 error, 2 check failed (no reply before timeout, connection test failed).`;

type Handler = (ctx: Ctx) => Promise<CommandResult>;

const COMMANDS: Record<string, Handler | Record<string, Handler>> = {
  login,
  logout,
  whoami,
  orgs,
  use,
  logs,
  chat: { send: chatSend },
  conv: { list: convList, show: convShow },
  plugins: { list: pluginsList, tools: pluginsTools, test: pluginsTest, call: pluginsCall },
};

export function resolveHandler(positionals: string[]): Handler | undefined {
  const entry = COMMANDS[positionals[0] ?? ""];
  if (!entry) return undefined;
  if (typeof entry === "function") return entry;
  return entry[positionals[1] ?? ""];
}

async function main(argv: string[]): Promise<number> {
  let json = argv.includes("--json");
  try {
    const args = parseArgs(argv);
    json = boolFlag(args, "json");
    const handler = resolveHandler(args.positionals);
    if (!handler || boolFlag(args, "help")) {
      console.log(HELP);
      return handler || args.positionals.length === 0 ? 0 : 1;
    }
    const target = resolveTargetName(stringFlag(args, "target"), loadConfig());
    const result = await handler(buildCtx(args, target));
    console.log(json ? JSON.stringify(result.data) : result.text.join("\n"));
    return result.exitCode ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof HayApiError ? error.code : error instanceof UsageError ? "USAGE" : "ERROR";
    if (json) console.log(JSON.stringify({ error: { code, message } }));
    else console.error(`error: ${message}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
