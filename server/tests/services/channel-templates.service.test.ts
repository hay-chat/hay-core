import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * channel-templates.service — template list from the channel plugin's worker
 * (GET /templates) and template-send preparation (D13-3).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockFindPluginIdByChannel =
  jest.fn<(organizationId: string, channel: string) => Promise<string | null>>();
const mockGetOrStartWorker = jest.fn<() => Promise<{ port: number }>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    findPluginIdByChannel: mockFindPluginIdByChannel,
    getOrStartWorker: mockGetOrStartWorker,
  },
}));

import {
  listChannelTemplates,
  prepareChannelTemplate,
  renderTemplateBody,
} from "@server/services/channel-templates.service";

const mockFetch = jest.fn<(url: string, init?: unknown) => Promise<Response>>();
global.fetch = mockFetch as unknown as typeof fetch;

const respond = (status: number, body: unknown) =>
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

const ORDER_UPDATE = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  body: "Hi {{1}}, order {{2}} shipped.",
  variables: ["1", "2"],
};

describe("channel-templates.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindPluginIdByChannel.mockResolvedValue("some-channel-plugin");
    mockGetOrStartWorker.mockResolvedValue({ port: 5123 });
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(renderTemplateBody("Hi {{1}} and {{ name }}, {{x}}", { "1": "Ana", name: "Bo" })).toBe(
      "Hi Ana and Bo, {{x}}",
    );
  });

  it("reports web conversations and channels without a plugin as unsupported", async () => {
    expect(await listChannelTemplates("org-1", "web")).toEqual({ supported: false, templates: [] });
    mockFindPluginIdByChannel.mockResolvedValueOnce(null);
    expect(await listChannelTemplates("org-1", "sms")).toEqual({ supported: false, templates: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists the worker's templates", async () => {
    respond(200, { templates: [ORDER_UPDATE] });

    expect(await listChannelTemplates("org-1", "whatsapp")).toEqual({
      supported: true,
      templates: [ORDER_UPDATE],
    });
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:5123/templates");
  });

  it("treats a worker 404 as a channel without templates", async () => {
    respond(404, { error: "not found" });
    expect(await listChannelTemplates("org-1", "email")).toEqual({
      supported: false,
      templates: [],
    });
  });

  it("throws on a worker error or an invalid body", async () => {
    respond(500, {});
    await expect(listChannelTemplates("org-1", "whatsapp")).rejects.toThrow("500");
    respond(200, { templates: [{ name: "x" }] });
    await expect(listChannelTemplates("org-1", "whatsapp")).rejects.toThrow("invalid");
  });

  it("prepares the rendered text and the channelTemplate metadata", async () => {
    respond(200, { templates: [ORDER_UPDATE] });

    const prepared = await prepareChannelTemplate({
      organizationId: "org-1",
      channel: "whatsapp",
      name: "order_update",
      language: "en",
      values: { "1": " Ana ", "2": "42", extra: "ignored" },
    });

    expect(prepared).toEqual({
      content: "Hi Ana, order 42 shipped.",
      channelTemplate: {
        name: "order_update",
        language: "en",
        parameters: [
          { name: "1", value: "Ana" },
          { name: "2", value: "42" },
        ],
      },
    });
  });

  it("refuses unknown templates and missing variables", async () => {
    respond(200, { templates: [ORDER_UPDATE] });
    expect(
      await prepareChannelTemplate({
        organizationId: "org-1",
        channel: "whatsapp",
        name: "order_update",
        language: "pt_BR",
        values: {},
      }),
    ).toEqual({ error: "template_not_found" });

    respond(200, { templates: [ORDER_UPDATE] });
    expect(
      await prepareChannelTemplate({
        organizationId: "org-1",
        channel: "whatsapp",
        name: "order_update",
        language: "en",
        values: { "1": "Ana", "2": "  " },
      }),
    ).toEqual({ error: "missing_variables" });
  });
});
