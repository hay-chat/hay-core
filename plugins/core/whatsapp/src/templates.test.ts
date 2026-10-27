import { describe, expect, it, vi } from "vitest";
import { GraphApiError, GraphClient, type GraphTemplate } from "./graph-client.js";
import type { WhatsAppConnection } from "./connection.js";
import { STARTER_TEMPLATES, TemplateStore, placeholders, toStoredTemplate } from "./templates.js";
import { fakeLogger } from "./test/fakes.js";

const connection: WhatsAppConnection = {
  mode: "embedded-signup",
  accessToken: "biz-token",
  phoneNumberId: "976350592236691",
  wabaId: "1234567890",
};

const template = (overrides: Partial<GraphTemplate> = {}): GraphTemplate => ({
  id: "tpl-1",
  name: "order_update",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hi {{1}}, your order {{2}} shipped." }],
  ...overrides,
});

function setup(templates: GraphTemplate[] = []) {
  const graph = new GraphClient({
    logger: fakeLogger(),
    fetchImpl: vi.fn() as unknown as typeof fetch,
  });
  const list = vi.spyOn(graph, "listTemplates").mockResolvedValue(templates);
  const create = vi
    .spyOn(graph, "createTemplate")
    .mockImplementation(async (_waba, _token, t) => ({
      id: `new-${t.name}-${t.language}`,
      status: "PENDING",
    }));
  const store = new TemplateStore(graph, fakeLogger());
  return { graph, list, create, store };
}

describe("toStoredTemplate", () => {
  it("reads body variables in order and marks an approved body-only template sendable", () => {
    expect(toStoredTemplate(template())).toMatchObject({
      body: "Hi {{1}}, your order {{2}} shipped.",
      variables: ["1", "2"],
      parameterFormat: "POSITIONAL",
      sendable: true,
    });
  });

  it("keeps named variables", () => {
    const stored = toStoredTemplate(
      template({
        parameter_format: "NAMED",
        components: [{ type: "BODY", text: "Hi {{first_name}}" }],
      }),
    );
    expect(stored).toMatchObject({ parameterFormat: "NAMED", variables: ["first_name"] });
  });

  it("refuses media headers and variable button links", () => {
    expect(
      toStoredTemplate(
        template({
          components: [
            { type: "HEADER", format: "IMAGE" },
            { type: "BODY", text: "x" },
          ],
        }),
      ),
    ).toMatchObject({ unsupported: "header_media", sendable: false });
    expect(
      toStoredTemplate(
        template({
          components: [
            { type: "BODY", text: "x" },
            { type: "BUTTONS", buttons: [{ type: "URL", url: "https://shop.test/{{1}}" }] },
          ],
        }),
      ),
    ).toMatchObject({ unsupported: "button_variables", sendable: false });
  });

  it("is not sendable until approved", () => {
    expect(toStoredTemplate(template({ status: "PENDING" })).sendable).toBe(false);
  });

  it("dedupes placeholders", () => {
    expect(placeholders("{{1}} and {{ 1 }} then {{2}}")).toEqual(["1", "2"]);
  });
});

describe("TemplateStore", () => {
  it("syncs from Graph and lists only sendable templates for core", async () => {
    const { store, list } = setup([
      template(),
      template({ name: "promo", status: "REJECTED", rejected_reason: "PROMOTIONAL" }),
    ]);

    await store.sync(connection);

    expect(list).toHaveBeenCalledWith(connection.wabaId, connection.accessToken);
    expect(store.snapshot().templates).toHaveLength(2);
    expect(store.snapshot().templates[1]).toMatchObject({
      name: "promo",
      rejectedReason: "PROMOTIONAL",
    });
    expect(store.sendable()).toEqual([
      {
        name: "order_update",
        language: "en",
        category: "UTILITY",
        body: "Hi {{1}}, your order {{2}} shipped.",
        variables: ["1", "2"],
      },
    ]);
  });

  it("keeps the last list and reports the error when a sync fails", async () => {
    const { store, list } = setup([template()]);
    await store.sync(connection);
    list.mockRejectedValueOnce(new GraphApiError("boom", 500));

    await store.sync(connection);

    expect(store.snapshot()).toMatchObject({ error: "boom" });
    expect(store.snapshot().templates).toHaveLength(1);
  });

  it("applies status updates, rejections and deletions", async () => {
    const { store } = setup([template()]);
    await store.sync(connection);

    expect(
      store.applyStatusUpdate({
        event: "REJECTED",
        message_template_id: "tpl-1",
        reason: "INVALID_FORMAT",
      }),
    ).toBe(true);
    expect(store.find("order_update", "en")).toMatchObject({
      status: "REJECTED",
      rejectedReason: "INVALID_FORMAT",
      sendable: false,
    });

    store.applyStatusUpdate({
      event: "REINSTATED",
      message_template_name: "order_update",
      message_template_language: "en",
    });
    expect(store.find("order_update", "en")).toMatchObject({ status: "APPROVED", sendable: true });

    store.applyStatusUpdate({ event: "DELETED", message_template_id: "tpl-1" });
    expect(store.find("order_update", "en")).toBeUndefined();
    expect(store.applyStatusUpdate({ event: "APPROVED", message_template_id: "nope" })).toBe(false);
  });

  it("picks the conversation's language, then English, then any", async () => {
    const { store } = setup([
      template({
        id: "a",
        name: "hay_handoff_to_person",
        language: "en",
        components: [{ type: "BODY", text: "Hi" }],
      }),
      template({
        id: "b",
        name: "hay_handoff_to_person",
        language: "pt_BR",
        components: [{ type: "BODY", text: "Olá" }],
      }),
    ]);
    await store.sync(connection);

    expect(store.pickLanguage("hay_handoff_to_person", "pt")?.language).toBe("pt_BR");
    expect(store.pickLanguage("hay_handoff_to_person", "pt-BR")?.language).toBe("pt_BR");
    expect(store.pickLanguage("hay_handoff_to_person", "de")?.language).toBe("en");
    expect(store.pickLanguage("hay_handoff_to_person", null)?.language).toBe("en");
    expect(store.pickLanguage("missing", "en")).toBeUndefined();
  });
});

describe("TemplateStore.ensureStarterTemplates (D13-5)", () => {
  it("names every starter lowercase_underscore", () => {
    for (const starter of STARTER_TEMPLATES) {
      expect(starter.name).toMatch(/^[a-z0-9_]+$/);
      expect(starter.category).toBe("UTILITY");
    }
  });

  it("submits only the starters the account does not have", async () => {
    const { store, create } = setup([
      template({
        name: "hay_we_replied",
        language: "en",
        components: [{ type: "BODY", text: "x" }],
      }),
    ]);
    await store.sync(connection);

    const created = await store.ensureStarterTemplates(connection);

    expect(created).toBe(3);
    expect(create.mock.calls.map(([, , t]) => `${t.name}:${t.language}`)).toEqual([
      "hay_we_replied:pt_BR",
      "hay_handoff_to_person:en",
      "hay_handoff_to_person:pt_BR",
    ]);
    expect(store.find("hay_handoff_to_person", "en")).toMatchObject({
      status: "PENDING",
      sendable: false,
    });
  });

  it("is idempotent", async () => {
    const { store, create } = setup();
    await store.sync(connection);
    await store.ensureStarterTemplates(connection);
    create.mockClear();

    expect(await store.ensureStarterTemplates(connection)).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("never submits before a successful sync", async () => {
    const { store, create, list } = setup();
    expect(await store.ensureStarterTemplates(connection)).toBe(0);

    list.mockRejectedValueOnce(new GraphApiError("down", 0));
    await store.sync(connection);
    expect(await store.ensureStarterTemplates(connection)).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("logs a refused starter and continues", async () => {
    const { store, create } = setup();
    await store.sync(connection);
    create.mockRejectedValueOnce(new GraphApiError("name exists", 400, 100));

    expect(await store.ensureStarterTemplates(connection)).toBe(3);
  });
});
