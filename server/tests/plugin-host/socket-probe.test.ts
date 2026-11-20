import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "fs";
import { createServer, type Server } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { socketConfirmedGone, socketIsGone } from "../../plugin-host/socket-probe";

describe("socket probe", () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  let server: Server | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it("counts a missing socket as gone and a listening one as not", async () => {
    const socketPath = join(dir, "a.sock");
    expect(await socketIsGone(socketPath)).toBe(true);
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    expect(await socketIsGone(socketPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not count other errors as gone", async () => {
    // A path through a regular file fails with ENOTDIR, not ECONNREFUSED or ENOENT.
    expect(await socketIsGone("/etc/hosts/x.sock")).toBe(false);
  });

  it("needs the socket to stay gone across both probes", async () => {
    const socketPath = join(tmpdir(), `probe-late-${process.pid}.sock`);
    server = createServer();
    const confirmed = socketConfirmedGone(socketPath, 100);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    expect(await confirmed).toBe(false);
  });
});
