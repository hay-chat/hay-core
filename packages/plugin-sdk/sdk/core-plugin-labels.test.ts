/**
 * Hard check for core plugins (D20, Roger's answer 6): every config field and
 * select option and every declared setup step has an en and a pt-BR label in the plugin's
 * i18n/*.json. Loads each plugins/core/* source, runs its onInitialize against
 * the real register API, and reads what it registered.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import { createGlobalContext } from "../runner/global-context";
import type { HayLogger, HayPluginManifest } from "../types/index";

const CORE = resolve(__dirname, "../../../plugins/core");
const LOCALES = ["en", "pt-BR"] as const;

const silent: HayLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as HayLogger;

function readJson(path: string): Record<string, any> | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const plugins = readdirSync(CORE).filter((dir) => existsSync(join(CORE, dir, "src", "index.ts")));

async function registered(dir: string): Promise<PluginRegistry> {
  const pkg = readJson(join(CORE, dir, "package.json")) ?? {};
  const manifest = (pkg["hay-plugin"] ?? {}) as HayPluginManifest;
  const registry = new PluginRegistry();
  const globalCtx = createGlobalContext(silent, registry, manifest);
  const mod = await import(join(CORE, dir, "src", "index.ts"));
  const definition = mod.default(globalCtx);
  await definition.onInitialize?.(globalCtx);
  return registry;
}

describe("core plugin labels (en + pt-BR)", () => {
  it.each(plugins)("%s labels every config field and setup step", async (dir) => {
    const registry = await registered(dir);
    const schema = registry.getConfigSchema();
    const fields = Object.keys(schema);
    const steps = (registry.getSetup?.()?.steps ?? []).map((step: { id: string }) => step.id);

    const missing: string[] = [];
    for (const locale of LOCALES) {
      const messages = readJson(join(CORE, dir, "i18n", `${locale}.json`));
      if (!messages) {
        if (fields.length || steps.length) missing.push(`i18n/${locale}.json`);
        continue;
      }
      for (const field of fields) {
        if (!messages.config?.[field]?.label) missing.push(`${locale}: config.${field}.label`);
        for (const option of schema[field].options ?? []) {
          if (!messages.config?.[field]?.options?.[option.value]) {
            missing.push(`${locale}: config.${field}.options.${option.value}`);
          }
        }
      }
      for (const step of steps) {
        if (!messages.setupSteps?.[step]?.title) missing.push(`${locale}: setupSteps.${step}.title`);
      }
    }
    expect(missing).toEqual([]);
  });
});
