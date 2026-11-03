import { describe, it, expect } from "@jest/globals";
import { packPluginChecksum, pluginChecksumChanges } from "../plugin-checksum";

describe("plugin checksum", () => {
  const source = "a".repeat(64);
  const deps = "b".repeat(64);

  it("packs the first 32 chars of each hash into 64 chars", () => {
    expect(packPluginChecksum(source, deps)).toBe("a".repeat(32) + "b".repeat(32));
  });

  it("reports which half changed", () => {
    const packed = packPluginChecksum(source, deps);
    expect(pluginChecksumChanges(packed, packed)).toEqual({ source: false, deps: false });
    expect(pluginChecksumChanges(packed, packPluginChecksum("c".repeat(64), deps))).toEqual({
      source: true,
      deps: false,
    });
    expect(pluginChecksumChanges(packed, packPluginChecksum(source, "c".repeat(64)))).toEqual({
      source: false,
      deps: true,
    });
  });

  it("treats a missing previous checksum as fully changed", () => {
    expect(pluginChecksumChanges(undefined, packPluginChecksum(source, deps))).toEqual({
      source: true,
      deps: true,
    });
  });
});
