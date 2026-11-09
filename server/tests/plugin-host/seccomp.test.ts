import { describe, expect, it } from "@jest/globals";
import { buildSeccompFilter } from "../../plugin-host/seccomp";

describe("worker seccomp filter", () => {
  it("is a whole number of 8-byte instructions that checks the architecture first", () => {
    for (const arch of ["x64", "arm64"]) {
      const filter = buildSeccompFilter(arch);
      expect(filter.length % 8).toBe(0);
      // First instruction loads seccomp_data.arch.
      expect(filter.readUInt16LE(0)).toBe(0x20);
      expect(filter.readUInt32LE(4)).toBe(4);
    }
  });

  it("refuses architectures it has no syscall numbers for", () => {
    expect(() => buildSeccompFilter("riscv64")).toThrow(/No seccomp filter/);
  });
});
