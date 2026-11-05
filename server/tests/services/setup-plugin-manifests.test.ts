import { describe, it, expect } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import {
  BUSINESS_TYPES,
  SETUP_HANDLES,
  SETUP_PLUGIN_GROUPS,
  type SetupHandle,
} from "@server/types/setup.types";
import { readSetupHints } from "../../services/setup/plugin-hints";

const CORE = path.resolve(__dirname, "../../../plugins/core");

interface RiskSpec {
  read?: string[];
  write?: Record<string, string>;
}

/**
 * Reads a plugin's `tool-risk.js` as text: some plugins ship it as ESM and some as CommonJS,
 * and only the tool names and write categories matter here.
 */
function parseRisk(source: string): RiskSpec {
  const readBlock = /read:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  const writeBlock = /write:\s*\{([\s\S]*?)\}/.exec(source)?.[1] ?? "";
  const read = [...readBlock.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((m) => m[1]);
  const write: Record<string, string> = {};
  for (const m of writeBlock.matchAll(/["']?([a-z][a-z0-9_]*)["']?\s*:\s*["']([a-z_]+)["']/g)) {
    write[m[1]] = m[2];
  }
  return { read, write };
}

/** Plugins that derive their risk map from a shared contract: read the registered tool names. */
function registeredWrites(pluginDir: string): RiskSpec {
  const dir = path.join(pluginDir, "mcp", "tools");
  const names = fs
    .readdirSync(dir)
    .flatMap((f) =>
      [
        ...fs
          .readFileSync(path.join(dir, f), "utf8")
          .matchAll(/registerTool\(\s*["']([a-z_]+)["']/g),
      ].map((m) => m[1]),
    );
  return { read: names, write: Object.fromEntries(names.map((n) => [n, "unknown"])) };
}

function readManifests() {
  return fs
    .readdirSync(CORE)
    .filter((dir) => fs.existsSync(path.join(CORE, dir, "package.json")))
    .map((dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(CORE, dir, "package.json"), "utf8"));
      const riskFile = path.join(CORE, dir, "mcp", "tool-risk.js");
      const parsed = fs.existsSync(riskFile)
        ? parseRisk(fs.readFileSync(riskFile, "utf8"))
        : undefined;
      const risk =
        parsed && parsed.read?.length === 0 && Object.keys(parsed.write ?? {}).length === 0
          ? registeredWrites(path.join(CORE, dir))
          : parsed;
      return { dir, setup: pkg["hay-plugin"]?.setup as Record<string, unknown> | undefined, risk };
    });
}

const manifests = readManifests();
const declared = manifests.filter((m) => m.setup);

describe("plugin manifests: setup block", () => {
  it("at least the commerce, payments, CRM, helpdesk, marketing, knowledge and booking plugins declare one", () => {
    const groups = new Set(declared.map((m) => m.setup!.group));
    expect([...groups].sort()).toEqual([...SETUP_PLUGIN_GROUPS].sort());
  });

  it("uses only the core vocabulary, with nothing unknown for core to drop", () => {
    for (const { dir, setup } of declared) {
      const hints = readSetupHints(setup);
      expect({ plugin: dir, hints }).not.toEqual({ plugin: dir, hints: undefined });
      expect(Object.keys(setup!).sort()).toEqual(
        Object.keys(setup!)
          .filter((k) => ["businessTypes", "group", "handles"].includes(k))
          .sort(),
      );
      for (const type of setup!.businessTypes as string[]) {
        expect(BUSINESS_TYPES as readonly string[]).toContain(type);
      }
      for (const handle of (setup!.handles as string[] | undefined) ?? []) {
        expect(SETUP_HANDLES as readonly string[]).toContain(handle);
      }
      // What the builder keeps is exactly what the plugin wrote.
      expect([...(hints?.businessTypes ?? [])].sort()).toEqual(
        [...(setup!.businessTypes as string[])].sort(),
      );
      expect([...(hints?.handles ?? [])].sort()).toEqual(
        [...((setup!.handles as string[]) ?? [])].sort(),
      );
      expect((setup!.businessTypes as string[]).length).toBeGreaterThan(0);
    }
  });

  it("channels never declare one (channels come from the manifest `channel` field)", () => {
    for (const dir of ["chatwoot", "whatsapp", "instagram", "messenger", "email-channel"]) {
      expect(manifests.find((m) => m.dir === dir)?.setup).toBeUndefined();
    }
  });
});

describe("plugin manifests: handles match real tools", () => {
  const toolNames = (risk: RiskSpec) => [...(risk.read ?? []), ...Object.keys(risk.write ?? {})];
  const writeWith = (risk: RiskSpec, ...categories: string[]) =>
    Object.entries(risk.write ?? {}).some(([, category]) => categories.includes(category));

  const proves: Record<SetupHandle, (risk: RiskSpec) => boolean> = {
    orders: (risk) => toolNames(risk).some((n) => /_get_order$/.test(n)),
    // A tool that only records a request (category "note") does not issue a refund.
    refunds: (risk) =>
      writeWith(risk, "refund") ||
      Object.keys(risk.write ?? {}).some((n) => /^[a-z]+_(create_)?refund$/.test(n)),
    order_changes: (risk) => writeWith(risk, "cancel", "address_change"),
    billing: () => false,
    subscriptions: () => false,
    bookings: (risk) => toolNames(risk).some((n) => /book/i.test(n)),
  };

  it("every handle of a local-MCP plugin is backed by a tool of that kind", () => {
    for (const { dir, setup, risk } of declared) {
      if (!risk) continue;
      for (const handle of (setup!.handles as SetupHandle[] | undefined) ?? []) {
        expect({ plugin: dir, handle, backed: proves[handle](risk) }).toEqual({
          plugin: dir,
          handle,
          backed: true,
        });
      }
    }
  });

  it("nuvemshop does not claim refunds: its refund tool only records a request", () => {
    const nuvem = declared.find((m) => m.dir === "nuvemshop")!;
    expect(nuvem.setup!.handles).not.toContain("refunds");
    expect(nuvem.setup!.handles).toEqual(expect.arrayContaining(["orders", "order_changes"]));
  });

  it("stripe's hosted tools back what it claims", () => {
    const source = fs.readFileSync(path.join(CORE, "stripe/src/index.ts"), "utf8");
    const stripe = declared.find((m) => m.dir === "stripe")!;
    const needs: Record<string, string> = {
      refunds: "create_refund",
      billing: "list_invoices",
      subscriptions: "cancel_subscription",
    };
    for (const handle of stripe.setup!.handles as string[]) {
      expect(source).toMatch(new RegExp(`\\b${needs[handle]}\\b`));
    }
  });

  it("plugins with no request-level tools declare no handles", () => {
    for (const dir of ["hubspot", "twenty", "zendesk", "klaviyo", "notion", "atlassian"]) {
      const m = declared.find((d) => d.dir === dir)!;
      expect(m.setup!.handles ?? []).toEqual([]);
    }
  });
});
