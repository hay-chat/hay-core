import { describe, expect, it } from "@jest/globals";
import { buildSeccompFilter } from "../../plugin-host/seccomp";

const X86_64 = 0xc000003e;
const ALLOW = 0x7fff0000;
const EPERM = 0x00050001;
const ENOSYS = 0x00050026;

/** Runs a classic BPF filter against one system call and returns its verdict. */
function verdict(filter: Buffer, arch: number, nr: number, cloneFlags = 0): number {
  const fields: Record<number, number> = { 0: nr >>> 0, 4: arch, 16: cloneFlags };
  let accumulator = 0;
  for (let pc = 0; pc * 8 < filter.length; pc++) {
    const code = filter.readUInt16LE(pc * 8);
    const jt = filter.readUInt8(pc * 8 + 2);
    const jf = filter.readUInt8(pc * 8 + 3);
    const k = filter.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) accumulator = fields[k];
    else if (code === 0x06) return k;
    else if (code === 0x15) pc += accumulator === k ? jt : jf;
    else if (code === 0x35) pc += accumulator >= k ? jt : jf;
    else if (code === 0x45) pc += (accumulator & k) !== 0 ? jt : jf;
    else throw new Error(`Unexpected instruction ${code}`);
  }
  throw new Error("Filter ended without a verdict");
}

describe("worker seccomp filter", () => {
  it("refuses namespace and mount calls on x86-64 and allows ordinary ones", () => {
    const filter = buildSeccompFilter("x64");
    expect(verdict(filter, X86_64, 272)).toBe(EPERM); // unshare
    expect(verdict(filter, X86_64, 165)).toBe(EPERM); // mount
    expect(verdict(filter, X86_64, 435)).toBe(ENOSYS); // clone3
    expect(verdict(filter, X86_64, 56, 0x10000000)).toBe(EPERM); // clone with a new user namespace
    expect(verdict(filter, X86_64, 56, 0x00010000)).toBe(ALLOW); // clone for a thread
    expect(verdict(filter, X86_64, 0)).toBe(ALLOW); // read
  });

  it("refuses x32 system call numbers", () => {
    const filter = buildSeccompFilter("x64");
    expect(verdict(filter, X86_64, 0x40000000 + 272)).toBe(ENOSYS); // x32 unshare
    expect(verdict(filter, X86_64, 0x40000000 + 165)).toBe(ENOSYS); // x32 mount
  });

  it("stops the process for any other architecture", () => {
    expect(verdict(buildSeccompFilter("x64"), 0x40000003, 310)).toBe(0x80000000); // i386
  });

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
