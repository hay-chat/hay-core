import { describe, it, expect } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import {
  buildBoard,
  isEverythingReady,
  type BoardFacts,
  type BoardPlugin,
} from "../../services/setup/board";
import type { SetupQuestion, SetupSettings } from "@server/types/setup.types";

const NOW = "2026-11-05T10:00:00.000Z";
const plugin = (over: Partial<BoardPlugin> & Pick<BoardPlugin, "id">): BoardPlugin => ({
  name: over.id.toUpperCase(),
  handles: [],
  businessTypes: ["store"],
  connected: false,
  ...over,
});
const need = (id: string, needs: SetupQuestion["needs"], extra: Partial<SetupQuestion> = {}) =>
  ({ id, text: id, source: "catalog", needs, ...extra }) as SetupQuestion;
const run = (
  questions: SetupQuestion[],
  plugins: BoardPlugin[],
  toolPluginIds: string[] = [],
  over: Partial<BoardFacts> = {},
) => {
  const setup: SetupSettings = { businessType: "store", toolPluginIds, channels: [], questions };
  return buildBoard({
    setup,
    site: { state: { state: "done", discovered: 0, processed: 0 } },
    plugins,
    playbooks: [],
    hasRealConversations: false,
    ...over,
  });
};

describe("platform rows follow the platform that really handles the request", () => {
  const nuvem = plugin({ id: "nuvem", handles: ["orders", "order_changes"], connected: true });
  const shop = plugin({ id: "shop", handles: ["orders", "refunds", "order_changes"] });

  it("a chosen platform that does not handle the need is replaced by one that does", () => {
    const board = run([need("refund", "refunds")], [nuvem, shop], ["nuvem"]);
    expect(board.rows[0]).toMatchObject({ status: "needs_connection", plugin: { id: "shop" } });
    expect(board.upNext).toMatchObject({
      kind: "connect",
      plugin: { id: "shop" },
      capability: "refunds",
    });
  });

  it("offers choose_platform when nothing suitable handles the need", () => {
    const board = run([need("refund", "refunds")], [nuvem], ["nuvem"]);
    expect(board.rows[0].plugin).toBeUndefined();
    expect(board.upNext).toEqual({ kind: "choose_platform", unlocks: 1, capability: "refunds" });
  });

  it("offers choose_platform instead of guessing when answers were saved with no tools picked", () => {
    const board = run([need("refund", "refunds")], [shop]);
    expect(board.rows[0].plugin).toBeDefined(); // not yet answered: manifests still suggest

    const saved = (plugins: BoardPlugin[]) =>
      buildBoard({
        setup: {
          businessType: "store",
          toolPluginIds: [],
          channels: [],
          questions: [need("refund", "refunds")],
          answeredAt: NOW,
        },
        site: { state: { state: "done", discovered: 0, processed: 0 } },
        plugins,
        playbooks: [],
        hasRealConversations: false,
      });
    const unchosen = saved([shop]);
    expect(unchosen.rows[0]).toMatchObject({ status: "needs_connection" });
    expect(unchosen.rows[0].plugin).toBeUndefined();
    expect(unchosen.upNext).toEqual({ kind: "choose_platform", unlocks: 1, capability: "refunds" });

    // A platform really connected afterwards is still used.
    expect(saved([{ ...shop, connected: true }]).rows[0].plugin?.id).toBe("shop");
  });

  it("does not suggest a platform meant for another business type", () => {
    const booking = plugin({ id: "cal", handles: ["bookings"], businessTypes: ["service"] });
    expect(run([need("book", "bookings")], [booking]).rows[0].plugin).toBeUndefined();
  });

  it("prefers a connected platform even when the customer picked another", () => {
    const connectedShop = { ...shop, connected: true };
    const board = run([need("track", "orders")], [nuvem, connectedShop], ["nuvem"]);
    // Both are connected and the chosen one wins.
    expect(board.rows[0].plugin?.id).toBe("nuvem");
    const board2 = run(
      [need("track", "orders")],
      [{ ...nuvem, connected: false }, connectedShop],
      ["nuvem"],
    );
    expect(board2.rows[0].plugin?.id).toBe("shop");
  });

  it("an unknown connection is not a connection", () => {
    const board = run([need("track", "orders")], [{ ...shop, connected: false }], ["shop"]);
    expect(board.rows[0].status).toBe("needs_connection");
  });
});

describe("playbook states after connecting", () => {
  const shop = plugin({ id: "shop", handles: ["orders"], connected: true });

  it("reports why no playbook exists and asks the customer to write one", () => {
    const board = run(
      [need("a", "orders", { playbookAttempt: { outcome: "no_tool", at: NOW } })],
      [shop],
      ["shop"],
    );
    expect(board.rows[0]).toMatchObject({ status: "playbook_missing", generation: "no_tool" });
    expect(board.upNext).toEqual({ kind: "write_playbook", questionId: "a", text: "a" });
  });

  it("a failed attempt is reported as failed", () => {
    const board = run(
      [need("a", "orders", { playbookAttempt: { outcome: "failed", at: NOW } })],
      [shop],
      ["shop"],
    );
    expect(board.rows[0].generation).toBe("failed");
  });

  it("a pending playbook is never offered as the next step", () => {
    const board = run([need("a", "orders")], [shop], ["shop"]);
    expect(board.upNext.kind).not.toBe("write_playbook");
  });

  it("turning a playbook on is the next step, and ready only once it is active", () => {
    const withDraft = run([need("a", "orders", { playbookId: "p" })], [shop], ["shop"], {
      playbooks: [{ id: "p", title: "Order status", active: false, steps: ["One"] }],
    });
    expect(withDraft.upNext).toEqual({ kind: "playbook", questionId: "a", title: "Order status" });
    expect(isEverythingReady(withDraft.rows)).toBe(false);

    const active = run([need("a", "orders", { playbookId: "p" })], [shop], ["shop"], {
      playbooks: [{ id: "p", title: "Order status", active: true, steps: [] }],
    });
    expect(isEverythingReady(active.rows)).toBe(true);
  });
});

describe("finished only when platform rows are ready too", () => {
  it("an empty list is never finished; any non-ready row blocks it", () => {
    expect(isEverythingReady([])).toBe(false);
    const answered = {
      id: "d",
      text: "d",
      source: "catalog",
      check: {
        outcome: "answered",
        answer: "x",
        sources: [],
        checkedAt: NOW,
        turn: { state: "passed" },
      },
    } as SetupQuestion;
    const shop = plugin({ id: "shop", handles: ["orders"], connected: true });
    expect(isEverythingReady(run([answered, need("o", "orders")], [shop], ["shop"]).rows)).toBe(
      false,
    );
    expect(isEverythingReady(run([answered], []).rows)).toBe(true);
  });
});
