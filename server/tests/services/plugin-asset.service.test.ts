import fs from "fs";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

const findByPluginId = jest.fn();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId: (...args: unknown[]) => findByPluginId(...args) },
}));

import {
  PluginAssetService,
  isValidPluginName,
  resolveWithin,
} from "../../services/plugin-asset.service";

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

function mockRequest(params: Record<string, string>): Request {
  return { params, headers: {} } as unknown as Request;
}

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
      pluginId === "demo" ? { pluginId: "demo", pluginPath: "demo" } : null,
    );
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
    await service.serveUIAsset(mockRequest({ pluginName: "demo", assetPath: "ui.js" }), ok.res);
    expect(ok.captured.statusCode).toBe(200);
    expect(ok.captured.headers["content-type"]).toBe("application/javascript");

    const unregistered = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "unregistered", assetPath: "ui.js" }),
      unregistered.res,
    );
    expect(unregistered.captured.statusCode).toBe(404);

    const linked = mockResponse();
    await service.serveUIAsset(
      mockRequest({ pluginName: "demo", assetPath: "linked.js" }),
      linked.res,
    );
    expect(linked.captured.statusCode).toBe(404);
  });
});
