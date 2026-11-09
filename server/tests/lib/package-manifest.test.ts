import fs from "fs";
import path from "path";
import { builtinModules } from "module";

/**
 * Guards the server's runtime dependency list: production runs `node dist/main.js`,
 * so every package the server imports must be declared here (not borrowed from
 * another workspace through hoisting), and frontend or test tooling must not be.
 */
const SERVER_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const serverPkg = readJson(path.join(SERVER_ROOT, "package.json"));
const rootPkg = readJson(path.join(REPO_ROOT, "package.json"));

const SKIP_DIRS = new Set(["node_modules", "dist", "tests", "__tests__", "scripts"]);
// plugin-ui.service.ts emits a Vue SFC template as a string; those imports run in the dashboard.
// run-worker.ts evaluates tsx only when the entry is a .ts file, which never happens in the build.
const TEMPLATE_ONLY_IMPORTS = new Set(["vue", "lucide-vue-next", "@/components", "tsx"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

function runtimeImports(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern =
    /^\s*(?:import\s+(?!type\b)[^;]*?from\s+|import\s+|export\s+(?!type\b)[^;]*?from\s+)["']([^"'.][^"']*)["']|\brequire\(\s*["']([^"'.][^"']*)["']\s*\)|\bimport\(\s*["']([^"'.][^"']*)["']\s*\)/gm;
  for (const file of sourceFiles(SERVER_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith("node:") || specifier.startsWith("@server/")) continue;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (builtinModules.includes(name) || TEMPLATE_ONLY_IMPORTS.has(name)) continue;
      if (!found.has(name)) found.set(name, path.relative(SERVER_ROOT, file));
    }
  }
  return found;
}

describe("server package manifest", () => {
  const dependencies: Record<string, string> = serverPkg.dependencies;

  it("declares every package the server imports at runtime", () => {
    const undeclared = [...runtimeImports()]
      .filter(([name]) => !dependencies[name])
      .map(([name, file]) => `${name} (${file})`);
    expect(undeclared).toEqual([]);
  });

  it("keeps frontend and test tooling out of runtime dependencies", () => {
    const forbidden = Object.keys(dependencies).filter((name) =>
      /^(nuxt|vue|vue-.*|pinia.*|@nuxt\/.*|@nuxtjs\/.*|@pinia\/.*|@vueuse\/.*|eslint.*|@typescript-eslint\/.*|prettier.*|jest|ts-jest|vitest|@playwright\/.*|nodemon|@types\/.*)$/.test(
        name,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it("documents every root dependency override", () => {
    expect(Object.keys(rootPkg["//overrides"] ?? {}).sort()).toEqual(
      Object.keys(rootPkg.overrides).sort(),
    );
  });
});
