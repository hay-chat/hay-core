import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseFrontMatter } from "../../../demo-account/scripts/hay/markdown";
import { applySeed } from "../../../demo-account/scripts/hay/seed";
import {
  hayAssistantContent,
  HAY_ASSISTANT_ROOT,
  parseSteps,
  resolveHayAction,
} from "../seed-hay-assistant";

const knowledgeDir = join(HAY_ASSISTANT_ROOT, "knowledge");

describe("Hay assistant content", () => {
  const content = hayAssistantContent();

  it("loads every knowledge document and playbook", () => {
    expect(content.docs.length).toBe(
      readdirSync(knowledgeDir).filter((f) => f.endsWith(".md") && f !== "README.md").length,
    );
    expect(content.playbooks.length).toBeGreaterThanOrEqual(8);
    expect(new Set(content.docs.map((d) => d.title)).size).toBe(content.docs.length);
  });

  it("resolves every playbook action to a Cal.com tool", () => {
    expect(content.checkActions(content.playbooks)).toEqual([]);
    const booking = content.playbooks.find((p) => p.file.includes("book-a-meeting"));
    expect(booking?.actions).toEqual(
      expect.arrayContaining(["list_event_types", "get_available_slots", "create_booking"]),
    );
    expect(() => resolveHayAction("shopify_get_order")).toThrow();
  });

  it("gives every knowledge document sources and a verification date", () => {
    for (const file of readdirSync(knowledgeDir).filter((f) => f.endsWith(".md"))) {
      const { data } = parseFrontMatter(readFileSync(join(knowledgeDir, file), "utf8"));
      expect(Array.isArray(data.sources) && data.sources.length > 0, `${file} sources`).toBe(true);
      expect(data.verified, `${file} verified`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps TODO(Roger) markers out of the published text", () => {
    for (const doc of content.docs) expect(doc.content).not.toContain("TODO(Roger)");
    for (const playbook of content.playbooks)
      expect(playbook.markdown).not.toContain("TODO(Roger)");
  });

  it("dry-runs without a client and sends nothing", async () => {
    const report = await applySeed(null, content, {
      dryRun: true,
      playbookStatus: "active",
      steps: parseSteps(undefined),
      log: vi.fn(),
    });
    expect(report.created.length).toBe(content.docs.length + content.playbooks.length);
  });

  it("only loads the assistant when asked", () => {
    expect([...parseSteps(undefined)]).toEqual(["docs", "playbooks"]);
    expect(parseSteps("assistant").has("assistant")).toBe(true);
    expect(() => parseSteps("settings")).toThrow();
  });
});
