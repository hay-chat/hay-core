import { describe, it, expect, jest, afterEach, beforeAll, afterAll } from "@jest/globals";
import net from "node:net";

/**
 * D8-4: clamd seam. Without CLAMAV_HOST nothing is scanned ("skipped");
 * with it, documents are pending until clamd answers over INSTREAM.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { config } from "@server/config/env";
import {
  initialScanStatus,
  isScanCleared,
  parseClamdReply,
  scanWithClamd,
} from "@server/services/media-scan.service";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** A tiny clamd: reads the INSTREAM chunks and flags the EICAR string. */
function fakeClamd(): net.Server {
  return net.createServer((socket) => {
    let data = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      const command = "zINSTREAM\0";
      if (data.length < command.length + 4) return;
      let offset = command.length;
      const body: Buffer[] = [];
      while (offset + 4 <= data.length) {
        const size = data.readUInt32BE(offset);
        if (size === 0) {
          const text = Buffer.concat(body).toString();
          socket.end(text.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (offset + 4 + size > data.length) return;
        body.push(data.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
}

/** config is `as const`; tests point the scanner at the fake clamd. */
const clamav = config.storage.clamav as { host: string | null; port: number };

describe("media scan", () => {
  const original = { ...clamav };
  let server: net.Server;
  let port: number;

  beforeAll(async () => {
    server = fakeClamd();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  afterEach(() => {
    clamav.host = original.host;
    clamav.port = original.port;
  });

  it("skips every file when CLAMAV_HOST is unset", async () => {
    clamav.host = null;
    expect(initialScanStatus("application/pdf")).toBe("skipped");
    await expect(scanWithClamd(Buffer.from("x"))).resolves.toBe("skipped");
  });

  it("holds documents, not photos, when a scanner is configured", () => {
    clamav.host = "127.0.0.1";
    expect(initialScanStatus("application/pdf")).toBe("pending");
    expect(initialScanStatus("text/csv")).toBe("pending");
    expect(initialScanStatus("image/jpeg")).toBe("skipped");
  });

  it("gets clean and infected verdicts from clamd", async () => {
    clamav.host = "127.0.0.1";
    clamav.port = port;
    await expect(scanWithClamd(Buffer.from("%PDF-1.4 hello"))).resolves.toBe("clean");
    await expect(scanWithClamd(Buffer.from(EICAR))).resolves.toBe("infected");
    // Several INSTREAM chunks.
    await expect(scanWithClamd(Buffer.alloc(200 * 1024, 97))).resolves.toBe("clean");
  });

  it("fails closed when clamd is unreachable", async () => {
    clamav.host = "127.0.0.1";
    clamav.port = 1;
    await expect(scanWithClamd(Buffer.from("x"))).resolves.toBe("error");
  });

  it("parses clamd replies and clears only skipped/clean/unscanned files", () => {
    expect(parseClamdReply("stream: OK\0")).toBe("clean");
    expect(parseClamdReply("stream: Win.Test FOUND\0")).toBe("infected");
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toBe("error");
    expect([null, undefined, "skipped", "clean"].every((s) => isScanCleared(s as never))).toBe(true);
    expect(["pending", "infected", "error"].some((s) => isScanCleared(s as never))).toBe(false);
  });
});
