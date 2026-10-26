import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Nuxt only resolves named route middleware (`definePageMeta({ middleware: "x" })`)
// from `middleware/<x>.ts`. Global middleware (`*.global.ts`) runs on every route
// and cannot be referenced by name. A dangling name is a runtime 500 on that
// page ("Unknown route middleware"), not a build error, so we guard it here.

const dashboardDir = join(__dirname, "..");
const middlewareDir = join(dashboardDir, "middleware");

function walkVueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return walkVueFiles(fullPath);
    return fullPath.endsWith(".vue") ? [fullPath] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// Matches `middleware: "auth"`, `middleware: 'auth'`, and `middleware: ["auth", 'other']`.
const middlewareProperty = /\bmiddleware\s*:\s*(\[[^\]]*\]|["'][^"']+["'])/g;

function namedMiddlewares(source: string): string[] {
  const names: string[] = [];
  for (const match of stripComments(source).matchAll(middlewareProperty)) {
    for (const quoted of match[1].matchAll(/["']([^"']+)["']/g)) {
      names.push(quoted[1]);
    }
  }
  return names;
}

const nameableMiddlewares = readdirSync(middlewareDir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".global.ts"))
  .map((file) => basename(file, ".ts"));

const vueFiles = [
  ...walkVueFiles(join(dashboardDir, "pages")),
  ...walkVueFiles(join(dashboardDir, "layouts")),
];

describe("route middleware references", () => {
  it("every named middleware in pages/ and layouts/ has a middleware/<name>.ts file", () => {
    const dangling = vueFiles.flatMap((file) =>
      namedMiddlewares(readFileSync(file, "utf8"))
        .filter((name) => !nameableMiddlewares.includes(name))
        .map((name) => `${relative(dashboardDir, file)} -> "${name}"`),
    );

    expect(
      dangling,
      `Named middlewares without a middleware/<name>.ts file:\n${dangling.join("\n")}`,
    ).toEqual([]);
  });

  it("extracts names from string and array forms and ignores comments", () => {
    const sample = `
      // middleware: "commented-out",
      definePageMeta({ middleware: ["auth", 'guest'] });
      definePageMeta({ middleware: "admin" });
    `;
    expect(namedMiddlewares(sample)).toEqual(["auth", "guest", "admin"]);
  });
});
