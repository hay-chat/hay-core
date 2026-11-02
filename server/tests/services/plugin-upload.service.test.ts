import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import AdmZip from "adm-zip";
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
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId, findCustomByPluginId },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
const uploadPluginZip = jest.fn<(opts: unknown) => Promise<unknown>>();
jest.mock("@server/services/storage.service", () => ({ storageService: { uploadPluginZip } }));
const registerPlugin = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { registerPlugin },
}));

import {
  pluginUploadService,
  requireCustomPluginsAllowed,
  handlePluginUploadError,
} from "@server/services/plugin-upload.service";

const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function pluginZip(name: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "package.json",
    Buffer.from(JSON.stringify({ name, "hay-plugin": { entry: "x.js" } })),
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
