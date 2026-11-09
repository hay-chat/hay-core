/**
 * Plugin workers run as separate processes with an environment built from
 * scratch. Tracing is added by hand in the server process only, so nothing of
 * it may reach a worker: no preloaded modules and no OTEL settings, even when
 * a manifest asks for them.
 */
jest.mock("@server/database/data-source", () => ({ AppDataSource: { getRepository: jest.fn() } }));
jest.mock("@server/services/port-allocator.service", () => ({
  getPortAllocator: () => ({ allocate: jest.fn(), release: jest.fn() }),
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/services/plugin-tools.service", () => ({ fetchAndStoreTools: jest.fn() }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));

import { PluginRunnerService } from "@server/services/plugin-runner.service";
import { isDeniedPluginEnv } from "@server/lib/plugin-env";

type EnvBuilder = { buildSDKEnv(params: object): Record<string, string> };

describe("plugin worker environment", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("carries no tracing preload or OTEL settings", () => {
    process.env.NODE_OPTIONS = "--require ./tracing-preload.js";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.invalid:4318";
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Basic abc";

    const env = (new PluginRunnerService() as unknown as EnvBuilder).buildSDKEnv({
      orgId: "org",
      pluginId: "plugin",
      port: 4100,
      workerSecret: "s",
      orgConfig: { org: { id: "org" }, config: {} },
      orgAuth: null,
      capabilities: [],
      allowedEnvVars: ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"],
    });

    expect(env.NODE_OPTIONS).toMatch(/^--max-old-space-size=\d+$/);
    expect(Object.keys(env).filter((key) => key.startsWith("OTEL_"))).toEqual([]);
  });

  it("refuses OTEL settings even when a manifest names them", () => {
    expect(isDeniedPluginEnv("OTEL_EXPORTER_OTLP_HEADERS")).toBe(true);
  });
});
