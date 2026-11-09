import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

const findByPluginId = jest.fn();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId: (...args: unknown[]) => findByPluginId(...args) },
}));

const findByOrgAndPlugin = jest.fn();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {
    findByOrgAndPlugin: (...args: unknown[]) => findByOrgAndPlugin(...args),
  },
}));

jest.mock("../../config/env", () => {
  const actual = jest.requireActual("../../config/env");
  return {
    ...actual,
    config: { ...actual.config, jwt: { ...actual.config.jwt, secret: "test-jwt-secret" } },
    getApiUrl: () => "http://api.test",
  };
});

import {
  PluginAssetService,
  canOrganizationLoadPluginUI,
  isValidPluginName,
  resolveWithin,
  signPluginUiUrl,
  verifyPluginUiSignature,
} from "../../services/plugin-asset.service";
import type { PluginRegistry } from "../../entities/plugin-registry.entity";

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

function mockResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, headers: {}, body: undefined };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
    send(body: unknown) {
      captured.body = body;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

function mockRequest(params: Record<string, string>, query: Record<string, string> = {}): Request {
  return { params, query, headers: {} } as unknown as Request;
}

/** Query of a URL signed by signPluginUiUrl. */
function signedQuery(pluginId: string, organizationId: string, ttlSeconds?: number) {
  const url = new URL(signPluginUiUrl(pluginId, "ui.js", organizationId, ttlSeconds));
  return Object.fromEntries(url.searchParams);
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

describe("plugin asset serving", () => {
  let root: string;
  let cwdSpy: jest.SpyInstance;
  let service: PluginAssetService;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-assets-"));
    fs.mkdirSync(path.join(root, "server"));
    const demo = path.join(root, "plugins", "demo");
    fs.mkdirSync(path.join(demo, "public"), { recursive: true });
    fs.mkdirSync(path.join(demo, "dist"), { recursive: true });
    fs.writeFileSync(path.join(demo, "public", "logo.txt"), "logo");
    fs.writeFileSync(path.join(demo, "public", "page.html"), "<script>1</script>");
    fs.writeFileSync(path.join(demo, "dist", "ui.js"), "window.x = 1;");
    fs.writeFileSync(path.join(demo, "thumbnail.svg"), "<svg/>");
    fs.writeFileSync(path.join(root, "plugins", "secret.js"), "secret");
    fs.symlinkSync(path.join(root, "plugins", "secret.js"), path.join(demo, "dist", "linked.js"));
    const unregistered = path.join(root, "plugins", "unregistered");
    fs.mkdirSync(unregistered);
    fs.writeFileSync(path.join(unregistered, "thumbnail.svg"), "<svg/>");

    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(path.join(root, "server"));
  });

  afterAll(() => {
    cwdSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    service = new PluginAssetService();
    findByPluginId.mockReset();
    findByPluginId.mockImplementation(async (pluginId: string) =>
      pluginId === "demo" ? { pluginId: "demo", pluginPath: "demo", sourceType: "core" } : null,
    );
    findByOrgAndPlugin.mockReset();
  });

  describe("isValidPluginName", () => {
    it.each(["demo", "hay-plugin-zendesk", "@hay.plugin_1"])("accepts %s", (name) => {
      expect(isValidPluginName(name)).toBe(true);
    });

    it.each(["..", ".", "a/b", "a\\b", "Demo", "", "a b"])("rejects %s", (name) => {
      expect(isValidPluginName(name)).toBe(false);
    });
  });

  describe("resolveWithin", () => {
    const base = () => path.join(root, "plugins", "demo", "public");

    it("resolves files inside the base directory", async () => {
      expect(await resolveWithin(base(), "logo.txt")).toBe(
        fs.realpathSync(path.join(base(), "logo.txt")),
      );
    });

    it.each(["../dist/ui.js", "../../secret.js", "/etc/passwd", "", "."])(
      "returns null for %s",
      async (rel) => {
        expect(await resolveWithin(base(), rel)).toBeNull();
      },
    );

    it("returns null when a symlink points outside the base directory", async () => {
      expect(
        await resolveWithin(path.join(root, "plugins", "demo", "dist"), "linked.js"),
      ).toBeNull();
    });
  });

  it("serves thumbnails for registered plugins only", async () => {
    const ok = mockResponse();
    await service.serveThumbnail(mockRequest({ pluginName: "demo" }), ok.res);
    expect(ok.captured.statusCode).toBe(200);
    expect(ok.captured.headers["content-type"]).toBe("image/svg+xml");
    expect(ok.captured.headers["content-security-policy"]).toBe("sandbox");

    const missing = mockResponse();
    await service.serveThumbnail(mockRequest({ pluginName: "unregistered" }), missing.res);
    expect(missing.captured.statusCode).toBe(404);

    const invalid = mockResponse();
    await service.serveThumbnail(mockRequest({ pluginName: ".." }), invalid.res);
    expect(invalid.captured.statusCode).toBe(404);
    expect(findByPluginId).toHaveBeenCalledTimes(2);
  });

  it("keeps public file requests inside the plugin's public directory", async () => {
    const ok = mockResponse();
    await service.servePublicFile(
      mockRequest({ pluginName: "demo", filePath: "logo.txt" }),
      ok.res,
    );
    expect(ok.captured.statusCode).toBe(200);
    expect(String(ok.captured.body)).toBe("logo");
    expect(ok.captured.headers["x-content-type-options"]).toBe("nosniff");

    const traversal = mockResponse();
    await service.servePublicFile(
      mockRequest({ pluginName: "demo", filePath: "../dist/ui.js" }),
      traversal.res,
    );
    expect(traversal.captured.statusCode).toBe(404);
  });

  it("does not expose public files or SVG thumbnails of uploaded plugins", async () => {
    findByPluginId.mockResolvedValue({
      pluginId: "demo",
      pluginPath: "demo",
      sourceType: "custom",
    });

    const file = mockResponse();
    await service.servePublicFile(
      mockRequest({ pluginName: "demo", filePath: "logo.txt" }),
      file.res,
    );
    expect(file.captured.statusCode).toBe(404);

    const thumbnail = mockResponse();
    await service.serveThumbnail(mockRequest({ pluginName: "demo" }), thumbnail.res);
    expect(thumbnail.captured.statusCode).toBe(404);
  });

  it("serves HTML from a plugin directory as a sandboxed download", async () => {
    for (let i = 0; i < 2; i++) {
      // Second pass exercises the cached branch.
      const { res, captured } = mockResponse();
      await service.servePublicFile(
        mockRequest({ pluginName: "demo", filePath: "page.html" }),
        res,
      );
      expect(captured.statusCode).toBe(200);
      expect(captured.headers["content-security-policy"]).toBe("sandbox");
      expect(captured.headers["content-disposition"]).toBe("attachment");
      expect(captured.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("serves UI bundles for registered plugins and refuses escapes", async () => {
    const ok = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "ui.js" }, signedQuery("demo", ORG_A)),
      ok.res,
    );
    expect(ok.captured.statusCode).toBe(200);
    expect(ok.captured.headers["content-type"]).toBe("application/javascript");
    expect(ok.captured.headers["cache-control"]).toBe("private, max-age=600");

    const unregistered = mockResponse();
    await service.serveUIAsset(
      mockRequest(
        { pluginName: "unregistered", assetPath: "ui.js" },
        signedQuery("unregistered", ORG_A),
      ),
      unregistered.res,
    );
    expect(unregistered.captured.statusCode).toBe(404);

    const linked = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "linked.js" }, signedQuery("demo", ORG_A)),
      linked.res,
    );
    expect(linked.captured.statusCode).toBe(404);
  });

  it("refuses UI bundle requests without a valid signature, even when cached", async () => {
    // Warm the cache with a signed request first.
    const warm = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "ui.js" }, signedQuery("demo", ORG_A)),
      warm.res,
    );
    expect(warm.captured.statusCode).toBe(200);

    const valid = signedQuery("demo", ORG_A);
    const cases: Record<string, string>[] = [
      {},
      { ...valid, sig: "forged" },
      { ...valid, org: ORG_B },
      signedQuery("demo", ORG_A, -1),
      signedQuery("other", ORG_A),
    ];
    for (const query of cases) {
      const refused = mockResponse();
      await service.serveUIAsset(
        mockRequest({ pluginName: "demo", assetPath: "ui.js" }, query),
        refused.res,
      );
      expect(refused.captured.statusCode).toBe(401);
      expect(refused.captured.body).not.toBe("window.x = 1;");
    }
  });

  it("refuses a custom plugin's UI bundle to organizations that may not load it", async () => {
    findByPluginId.mockResolvedValue({
      pluginId: "demo",
      pluginPath: "demo",
      sourceType: "custom",
      organizationId: ORG_A,
    });
    findByOrgAndPlugin.mockResolvedValue({ enabled: true });

    const otherOrg = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "ui.js" }, signedQuery("demo", ORG_B)),
      otherOrg.res,
    );
    expect(otherOrg.captured.statusCode).toBe(404);

    const owner = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "ui.js" }, signedQuery("demo", ORG_A)),
      owner.res,
    );
    expect(owner.captured.statusCode).toBe(200);
  });
});

describe("plugin UI URL signatures", () => {
  it("signs a URL for one plugin and organization that verifies until it expires", () => {
    const now = Date.UTC(2026, 0, 1);
    const url = new URL(signPluginUiUrl("demo", "style.css", ORG_A, 600, now));
    expect(url.origin + url.pathname).toBe("http://api.test/plugins/ui/demo/style.css");

    const query = Object.fromEntries(url.searchParams);
    expect(verifyPluginUiSignature("demo", query, now)).toBe(ORG_A);
    expect(verifyPluginUiSignature("demo", query, now + 601_000)).toBeNull();
    expect(verifyPluginUiSignature("other", query, now)).toBeNull();
    expect(verifyPluginUiSignature("demo", { ...query, org: ORG_B }, now)).toBeNull();
    expect(verifyPluginUiSignature("demo", { ...query, expires: "9999999999" }, now)).toBeNull();
  });
});

describe("canOrganizationLoadPluginUI", () => {
  const registry = (fields: Partial<PluginRegistry>) =>
    ({ pluginId: "demo", ...fields }) as PluginRegistry;

  beforeEach(() => findByOrgAndPlugin.mockReset());

  it("allows core plugins before they are enabled", async () => {
    findByOrgAndPlugin.mockResolvedValue(null);
    await expect(
      canOrganizationLoadPluginUI(registry({ sourceType: "core" }), ORG_A),
    ).resolves.toBe(true);
  });

  it.each(["custom", "git"] as const)(
    "allows a %s plugin only for its organization once enabled",
    async (sourceType) => {
      const plugin = registry({ sourceType, organizationId: ORG_A });

      findByOrgAndPlugin.mockResolvedValue({ enabled: true });
      await expect(canOrganizationLoadPluginUI(plugin, ORG_A)).resolves.toBe(true);
      await expect(canOrganizationLoadPluginUI(plugin, ORG_B)).resolves.toBe(false);

      findByOrgAndPlugin.mockResolvedValue({ enabled: false });
      await expect(canOrganizationLoadPluginUI(plugin, ORG_A)).resolves.toBe(false);

      findByOrgAndPlugin.mockResolvedValue(null);
      await expect(canOrganizationLoadPluginUI(plugin, ORG_A)).resolves.toBe(false);
    },
  );
});
