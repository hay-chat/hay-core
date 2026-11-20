/**
 * A bundled plugin's token carries what its manifest declares, so the manifest
 * must declare every capability the plugin's code uses, and no plugin API
 * capability it does not use. The usage is read from the plugin sources.
 */
import fs from "fs";
import path from "path";
import {
  PLUGIN_API_CAPABILITIES,
  PLUGIN_FEATURE_CAPABILITIES,
  PLUGIN_API_PROCEDURE_CAPABILITIES,
  declaredPluginCapabilities,
  isKnownPluginCapability,
} from "@server/lib/plugin-capabilities";

const CORE_PLUGINS_DIR = path.resolve(__dirname, "../../../plugins/core");
const SKIPPED_DIRS = new Set(["node_modules", "dist", "tests", "__tests__"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return /\.(ts|js|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

interface BundledPlugin {
  name: string;
  declared: string[];
  credentials: Array<{ name: string; source: string; capability: string; hosts: unknown[] }>;
  egress: unknown[];
  source: string;
}

const plugins: BundledPlugin[] = fs
  .readdirSync(CORE_PLUGINS_DIR, { withFileTypes: true })
  .filter((entry) => fs.existsSync(path.join(CORE_PLUGINS_DIR, entry.name, "package.json")))
  .map((entry) => {
    const dir = path.join(CORE_PLUGINS_DIR, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return {
      name: entry.name,
      declared: manifest["hay-plugin"].capabilities as string[],
      credentials: manifest["hay-plugin"].credentials ?? [],
      egress: manifest["hay-plugin"].network?.egress ?? [],
      source: sourceFiles(dir)
        .map((file) => fs.readFileSync(file, "utf8"))
        .join("\n"),
    };
  });

const quoted = (procedure: string) => new RegExp(`["'\`]${procedure.replace(".", "\\.")}["'\`]`);

/** Config fields flagged encrypted and not serverOnly: the ones a worker may pull. */
function secretFieldsOf(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\n\s{2,}(\w+):\s*\{([^]*?)\n\s{2,}\},?/g)) {
    const body = match[2];
    if (
      /encrypted:\s*true/.test(body) &&
      /type:\s*"/.test(body) &&
      !/serverOnly:\s*true/.test(body)
    ) {
      names.push(match[1]);
    }
  }
  return names;
}

/** Plugin API capabilities the sources need, with the evidence for each. */
function usedApiCapabilities(plugin: BundledPlugin): Map<string, string> {
  const used = new Map<string, string>();
  for (const [procedure, accepted] of Object.entries(PLUGIN_API_PROCEDURE_CAPABILITIES)) {
    if (!quoted(procedure).test(plugin.source)) continue;
    // A procedure that accepts several capabilities is satisfied by any declared one.
    const capability = accepted.find((c) => plugin.declared.includes(c)) ?? accepted[0];
    used.set(capability, procedure);
  }
  if (/\bctx\.productSource\b/.test(plugin.source)) used.set("products", "ctx.productSource");
  if (/\bctx\.disputes\b/.test(plugin.source)) used.set("disputes", "ctx.disputes");
  if (plugin.source.includes("/v1/plugin-api/send-email")) used.set("email", "send-email");
  return used;
}

describe("bundled plugin manifests", () => {
  it("recognise the same capabilities as the plugin runner", () => {
    const runner = fs.readFileSync(
      path.resolve(__dirname, "../../../packages/plugin-sdk/runner/bootstrap.ts"),
      "utf8",
    );
    const list = /const validCapabilities = \[([^\]]*)\]/.exec(runner)?.[1] ?? "";
    const inRunner = [...list.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect([...PLUGIN_API_CAPABILITIES, ...PLUGIN_FEATURE_CAPABILITIES].sort()).toEqual(
      inRunner.sort(),
    );
  });

  it("finds all 21 core plugins", () => {
    expect(plugins.map((p) => p.name)).toHaveLength(21);
  });

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares only capabilities core recognises",
    (_name, plugin) => {
      expect(plugin.declared.filter((c) => !isKnownPluginCapability(c))).toEqual([]);
      expect(declaredPluginCapabilities(plugin.declared)).toEqual(plugin.declared);
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares every capability its code uses",
    (_name, plugin) => {
      const missing = [...usedApiCapabilities(plugin)].filter(
        ([capability]) => !plugin.declared.includes(capability),
      );
      expect(missing).toEqual([]);
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares no plugin API capability it does not use",
    (_name, plugin) => {
      const used = usedApiCapabilities(plugin);
      // mcp and auth also describe what the plugin offers (MCP tools, a connected account).
      const unused = plugin.declared.filter(
        (capability) =>
          (PLUGIN_API_CAPABILITIES as readonly string[]).includes(capability) &&
          !["mcp", "auth", "credentials"].includes(capability) &&
          !used.has(capability),
      );
      expect(unused).toEqual([]);
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares the credentials capability exactly when it declares credentials",
    (_name, plugin) => {
      expect(plugin.declared.includes("credentials")).toBe(plugin.credentials.length > 0);
      expect(
        plugin.credentials.filter((credential) => !plugin.declared.includes(credential.capability)),
      ).toEqual([]);
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s sends each credential only to hosts it already declares for egress",
    (_name, plugin) => {
      const egress = plugin.egress.map((entry) => JSON.stringify(entry));
      for (const credential of plugin.credentials) {
        for (const host of credential.hosts) {
          expect(egress).toContain(JSON.stringify(host));
        }
      }
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares every secret config field its code reads, and only secret fields",
    (_name, plugin) => {
      const secrets = secretFieldsOf(plugin.source);
      const declared = plugin.credentials
        .filter((credential) => credential.source === "config")
        .map((credential) => credential.name);
      // A field counts as read when its name appears as a quoted string other than
      // as `config.field("name")`, which only names it for core's OAuth handling.
      const read = secrets.filter((name) =>
        new RegExp(`(?<!config\\.field\\()["'\`]${name}["'\`]`).test(plugin.source),
      );
      expect(declared.filter((name) => !secrets.includes(name))).toEqual([]);
      expect(read.filter((name) => !declared.includes(name))).toEqual([]);
    },
  );

  it.each(plugins.map((p) => [p.name, p] as const))(
    "%s declares the connected account's credentials when it registers an auth method",
    (_name, plugin) => {
      const registersAuth = /register\.auth\.\w+/.test(plugin.source);
      expect(plugin.credentials.some((credential) => credential.source === "auth")).toBe(
        registersAuth,
      );
    },
  );

  it("grants the revoke procedure to every plugin that calls it", () => {
    const callers = plugins.filter((p) => quoted("connection.revoke").test(p.source));
    expect(callers.length).toBeGreaterThan(0);
    for (const plugin of callers) {
      expect(
        PLUGIN_API_PROCEDURE_CAPABILITIES["connection.revoke"].some((c) =>
          plugin.declared.includes(c),
        ),
      ).toBe(true);
    }
  });
});
