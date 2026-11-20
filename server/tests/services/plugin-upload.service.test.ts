import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import AdmZip from "adm-zip";
import { promises as fs } from "fs";
import path from "path";
import { sha256Hex } from "@server/lib/plugin-pack";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";

const mockConfig = { plugins: { allowCustomPlugins: true, maxUploadSizeMB: 50 } };
jest.mock("@server/config/env", () => ({ config: mockConfig }));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ update: jest.fn() }) },
}));

const findByPluginId = jest.fn<(pluginId: string) => Promise<unknown>>();
const findCustomByPluginId = jest.fn<(pluginId: string, org: string) => Promise<unknown>>();
const findByOrganization = jest.fn<(org: string) => Promise<unknown[]>>();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId, findCustomByPluginId, findByOrganization },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
const uploadPluginZip = jest.fn<(opts: unknown) => Promise<unknown>>();
const deleteUpload = jest.fn<(id: string) => Promise<void>>();
jest.mock("@server/services/storage.service", () => ({
  storageService: { uploadPluginZip, delete: deleteUpload },
}));
const registerPlugin = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { registerPlugin },
}));

jest.mock("@server/services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({ isRunning: () => false, stopWorker: jest.fn() }),
}));

import {
  MAX_UPLOADED_PLUGINS_PER_ORG,
  pluginUploadService,
  requireCustomPluginsAllowed,
  handlePluginUploadError,
} from "@server/services/plugin-upload.service";

const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function pluginZip(name: string): Buffer {
  const zip = new AdmZip();
  const packageJson = JSON.stringify({ name, "hay-plugin": { entry: "x.js" } });
  const entry = "module.exports = {};";
  const listed = (content: string) => ({ sha256: sha256Hex(content), size: content.length });
  zip.addFile("package.json", Buffer.from(packageJson));
  zip.addFile("x.js", Buffer.from(entry));
  zip.addFile(
    "hay-pack.json",
    Buffer.from(
      JSON.stringify({
        format: 1,
        name,
        version: "1.0.0",
        files: { "package.json": listed(packageJson), "x.js": listed(entry) },
      }),
    ),
  );
  return zip.toBuffer();
}

function mockResponse() {
  const res = { statusCode: 0, body: undefined as unknown } as {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe("pluginUploadService.handleUpload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a package named like a core plugin and leaves the core row untouched", async () => {
    findByPluginId.mockResolvedValue({
      id: "core-row",
      pluginId: "hay-plugin-stripe",
      sourceType: "core",
    });
    const res = mockResponse();

    await pluginUploadService.handleUpload(
      {
        user: { id: "user-b" },
        organizationId: ORG_B,
        file: { buffer: pluginZip("hay-plugin-stripe"), originalname: "p.zip" },
      } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: expect.stringMatching(/not available/) });
    expect(uploadPluginZip).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("rejects a package whose id another organization already uses", async () => {
    findByPluginId.mockResolvedValue({
      pluginId: "shared-name",
      sourceType: "custom",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const res = mockResponse();

    await pluginUploadService.handleUpload(
      {
        user: { id: "user-b" },
        organizationId: ORG_B,
        file: { buffer: pluginZip("shared-name"), originalname: "p.zip" },
      } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(409);
    expect(registerPlugin).not.toHaveBeenCalled();
  });
});

describe("pluginUploadService.handleUpload with an archive that is not a valid pack", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findByPluginId.mockResolvedValue(null);
    findByOrganization.mockResolvedValue([]);
  });

  const upload = async (buffer: Buffer, body: Record<string, unknown> = {}) => {
    const res = mockResponse();
    await pluginUploadService.handleUpload(
      {
        user: { id: "user-b" },
        organizationId: ORG_B,
        body,
        file: { buffer, originalname: "p.zip" },
      } as unknown as Request,
      res as unknown as Response,
    );
    return res;
  };

  it("refuses an archive without hay-pack.json before storing or registering anything", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "package.json",
      Buffer.from(JSON.stringify({ name: "unpacked", "hay-plugin": { entry: "x.js" } })),
    );
    zip.addFile("x.js", Buffer.from(""));

    const res = await upload(zip.toBuffer());

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(/hay plugin pack/) });
    expect(uploadPluginZip).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("refuses an archive that differs from the sha256 the uploader sent", async () => {
    const res = await upload(pluginZip("checked"), { sha256: "0".repeat(64) });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: expect.stringMatching(/checksum does not match/) });
    expect(uploadPluginZip).not.toHaveBeenCalled();
  });

  it("accepts an archive that matches the sha256 the uploader sent", async () => {
    const buffer = pluginZip("checked");
    uploadPluginZip.mockResolvedValue({ upload: { path: "p", id: "u" } });

    await upload(buffer, { sha256: sha256Hex(buffer) });

    expect(uploadPluginZip).toHaveBeenCalled();
    await fs.rm(path.join(process.cwd(), "..", "plugins", "custom", ORG_B), {
      recursive: true,
      force: true,
    });
  });
});

describe("pluginUploadService limits and updates", () => {
  const customDir = path.join(process.cwd(), "..", "plugins", "custom", ORG_B);
  const send = async (method: "handleUpload" | "handleUpdate", buffer: Buffer, pluginId = "") => {
    const res = mockResponse();
    await pluginUploadService[method](
      {
        user: { id: "user-b" },
        organizationId: ORG_B,
        body: {},
        params: { pluginId },
        file: { buffer, originalname: "p.zip" },
      } as unknown as Request,
      res as unknown as Response,
    );
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findByPluginId.mockResolvedValue(null);
    registerPlugin.mockResolvedValue(undefined);
    deleteUpload.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(customDir, { recursive: true, force: true });
  });

  it("creates directories only inside the custom plugins directory", async () => {
    findByOrganization.mockResolvedValue([]);
    findCustomByPluginId.mockResolvedValue(null);
    const mkdir = jest.spyOn(fs, "mkdir");
    const customRoot = path.resolve(process.cwd(), "..", "plugins", "custom");

    const res = await send("handleUpload", pluginZip("staged-in-custom"));
    const created = mkdir.mock.calls.map(([dir]) => String(dir));
    mkdir.mockRestore();

    expect(res.statusCode).toBe(201);
    expect(created.length).toBeGreaterThan(0);
    for (const dir of created) expect(dir.startsWith(`${customRoot}${path.sep}`)).toBe(true);
  });

  it("refuses an upload once the organization holds the maximum number of plugins", async () => {
    findByOrganization.mockResolvedValue(
      Array.from({ length: MAX_UPLOADED_PLUGINS_PER_ORG }, () => ({ sourceType: "custom" })),
    );

    const res = await send("handleUpload", pluginZip("one-more"));

    expect(res.statusCode).toBe(409);
    expect(uploadPluginZip).not.toHaveBeenCalled();
  });

  it("keeps the old files until the new version is installed, and the old ZIP until the end", async () => {
    findCustomByPluginId.mockResolvedValue({
      id: "row",
      sourceType: "custom",
      zipUploadId: "old-upload",
    });
    uploadPluginZip.mockResolvedValue({ upload: { path: "p", id: "new-upload" } });
    const live = path.join(customDir, "swap-me");
    await fs.mkdir(live, { recursive: true });
    await fs.writeFile(path.join(live, "old.txt"), "old");
    registerPlugin.mockImplementation(async () => {
      expect(deleteUpload).not.toHaveBeenCalled();
      expect(await fs.readdir(live)).toContain("x.js");
    });

    const res = await send("handleUpdate", pluginZip("swap-me"), "swap-me");

    expect(res.statusCode).toBe(200);
    expect(await fs.readdir(live)).not.toContain("old.txt");
    expect(deleteUpload).toHaveBeenCalledWith("old-upload");
  });

  it("restores the previous files and keeps the old ZIP when registering the update fails", async () => {
    findCustomByPluginId.mockResolvedValue({
      id: "row",
      sourceType: "custom",
      zipUploadId: "old-upload",
    });
    uploadPluginZip.mockResolvedValue({ upload: { path: "p", id: "new-upload" } });
    const live = path.join(customDir, "swap-me");
    await fs.mkdir(live, { recursive: true });
    await fs.writeFile(path.join(live, "old.txt"), "old");
    registerPlugin.mockRejectedValue(new Error("register failed"));

    const res = await send("handleUpdate", pluginZip("swap-me"), "swap-me");

    expect(res.statusCode).toBe(400);
    expect(await fs.readdir(live)).toEqual(["old.txt"]);
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith("new-upload");
  });

  it("runs uploads of the same plugin one after another", async () => {
    findCustomByPluginId.mockResolvedValue({ id: "row", sourceType: "custom" });
    uploadPluginZip.mockResolvedValue({ upload: { path: "p", id: "u" } });
    let running = 0;
    let overlapped = false;
    registerPlugin.mockImplementation(async () => {
      running++;
      overlapped = overlapped || running > 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      running--;
    });

    await Promise.all([
      send("handleUpdate", pluginZip("same-one"), "same-one"),
      send("handleUpdate", pluginZip("same-one"), "same-one"),
    ]);

    expect(registerPlugin).toHaveBeenCalledTimes(2);
    expect(overlapped).toBe(false);
  });
});

describe("requireCustomPluginsAllowed", () => {
  it("refuses uploads when custom plugins are disabled", () => {
    mockConfig.plugins.allowCustomPlugins = false;
    const res = mockResponse();
    const next = jest.fn();

    requireCustomPluginsAllowed({} as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    mockConfig.plugins.allowCustomPlugins = true;
  });

  it("passes through when custom plugins are enabled", () => {
    const next = jest.fn();
    requireCustomPluginsAllowed({} as Request, mockResponse() as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("handlePluginUploadError", () => {
  const run = (err: unknown) => {
    const res = mockResponse();
    const next = jest.fn() as unknown as NextFunction;
    handlePluginUploadError(err, {} as Request, res as unknown as Response, next);
    return { res, next };
  };

  it("maps an oversized upload to 413", () => {
    expect(run(new multer.MulterError("LIMIT_FILE_SIZE")).res.statusCode).toBe(413);
  });

  it("maps other multer and file-filter errors to 400", () => {
    expect(run(new multer.MulterError("LIMIT_UNEXPECTED_FILE")).res.statusCode).toBe(400);
    expect(run(new Error("Only ZIP files are allowed")).res.statusCode).toBe(400);
  });
});
