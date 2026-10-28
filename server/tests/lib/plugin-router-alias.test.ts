import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import ts from "typescript";

/**
 * Reproduces the prod layout in a temp dir — a compiled server root
 * (server/dist, holding this helper at lib/ like tsc emits it) and a plugin
 * router bundle outside it that keeps a bare `require("@server/trpc")` — and
 * loads the router in a plain `node` child process, the way `node dist/main.js`
 * does. A child process is used because jest's own resolver (moduleNameMapper)
 * would resolve the alias and hide the bug.
 */
const HELPER_SRC = path.resolve(__dirname, "../../lib/plugin-router-alias.ts");
const NODE_PATH = [
  path.resolve(__dirname, "../../node_modules"),
  path.resolve(__dirname, "../../../node_modules"),
].join(path.delimiter);

describe("registerServerAliasForPlugins (plugin router @server/* resolution)", () => {
  let tmp: string;
  let helperJs: string;
  let routerFile: string;
  let serverTrpc: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-alias-"));
    const dist = path.join(tmp, "server", "dist");
    fs.mkdirSync(path.join(dist, "trpc"), { recursive: true });
    fs.mkdirSync(path.join(dist, "lib"), { recursive: true });
    serverTrpc = path.join(dist, "trpc", "index.js");
    fs.writeFileSync(serverTrpc, "exports.marker = 'server-trpc';");

    const { outputText } = ts.transpileModule(fs.readFileSync(HELPER_SRC, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    });
    helperJs = path.join(dist, "lib", "plugin-router-alias.js");
    fs.writeFileSync(helperJs, outputText);

    const pluginDist = path.join(tmp, "plugins", "core", "x", "dist");
    fs.mkdirSync(pluginDist, { recursive: true });
    routerFile = path.join(pluginDist, "router.cjs");
    fs.writeFileSync(
      routerFile,
      "exports.marker = require('@server/trpc').marker;" +
        "exports.resolved = require.resolve('@server/trpc');",
    );
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const runNode = (script: string) =>
    execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, NODE_PATH },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("fails without the alias (the prod bug)", () => {
    expect(() => runNode(`require(${JSON.stringify(routerFile)})`)).toThrow(
      /Cannot find module '@server\/trpc'/,
    );
  });

  it("resolves @server/* from a router bundle to the compiled server root", () => {
    const out = runNode(
      `require(${JSON.stringify(helperJs)}).registerServerAliasForPlugins();` +
        `const r = require(${JSON.stringify(routerFile)});` +
        `process.stdout.write(JSON.stringify(r));`,
    );
    const r = JSON.parse(out);
    expect(r.marker).toBe("server-trpc");
    // Same file the server itself loads, so tRPC `t` and singletons are shared.
    expect(r.resolved).toBe(serverTrpc);
  });
});
