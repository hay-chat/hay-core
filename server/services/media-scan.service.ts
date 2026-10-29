/**
 * Virus scan for conversation documents (D8-4), through clamd's INSTREAM
 * command. A seam, not a service of our own: without CLAMAV_HOST nothing is
 * scanned and files behave as before ("skipped").
 *
 * With CLAMAV_HOST, a new PDF/TXT/CSV upload is stored as "pending" and
 * scanned in the background. Until clamd says "clean" the file is held: the
 * media route answers 423, the vision pass does not read it, and the Inbox
 * shows "Scanning…". Infected files and failed scans stay blocked (fail closed).
 *
 * @module services/media-scan.service
 */

import net from "node:net";
import { In } from "typeorm";
import { config } from "@server/config/env";
import { Upload, type ScanStatus } from "@server/entities/upload.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("media-scan");

/** Types clamd checks. Photos, audio and video are re-encoded on ingest instead. */
export const SCANNED_TYPES = new Set(["application/pdf", "text/plain", "text/csv"]);

const SCAN_TIMEOUT_MS = 30_000;
const CHUNK_SIZE = 64 * 1024;
const POLL_MS = 500;

/** Statuses that let a file be served and read. */
export function isScanCleared(status: ScanStatus | null | undefined): boolean {
  return status === null || status === undefined || status === "skipped" || status === "clean";
}

export function isScanEnabled(): boolean {
  return !!config.storage.clamav.host;
}

/** Status for a new conversation-media upload. */
export function initialScanStatus(mimeType: string): ScanStatus {
  return isScanEnabled() && SCANNED_TYPES.has(mimeType) ? "pending" : "skipped";
}

/** Parse clamd's reply: "stream: OK", "stream: <name> FOUND", "... ERROR". */
export function parseClamdReply(reply: string): ScanStatus {
  const text = reply.replace(/\0/g, "").trim();
  if (/: OK$/.test(text)) return "clean";
  if (/ FOUND$/.test(text)) return "infected";
  return "error";
}

/** Send `buffer` to clamd (zINSTREAM) and return the verdict. Never throws. */
export function scanWithClamd(buffer: Buffer): Promise<ScanStatus> {
  const { host, port } = config.storage.clamav;
  if (!host) return Promise.resolve("skipped");

  return new Promise((resolve) => {
    let reply = "";
    let settled = false;
    const finish = (status: ScanStatus, error?: string) => {
      if (settled) return;
      settled = true;
      if (error) logger.warn({ error }, "clamd scan failed");
      socket.destroy();
      resolve(status);
    };

    const socket = net.createConnection({ host, port }, () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.setTimeout(SCAN_TIMEOUT_MS, () => finish("error", "timeout"));
    socket.on("data", (data) => {
      reply += data.toString("utf8");
      if (reply.includes("\0") || reply.includes("\n")) finish(parseClamdReply(reply));
    });
    socket.on("end", () =>
      finish(reply ? parseClamdReply(reply) : "error", reply ? undefined : "no reply"),
    );
    socket.on("error", (error) => finish("error", error.message));
  });
}

/** Scan a stored upload in the background and record the verdict. */
export function startScan(uploadId: string, buffer: Buffer): void {
  void scanWithClamd(buffer)
    .then(async (status) => {
      await Upload.update({ id: uploadId }, { scanStatus: status });
      if (status !== "clean")
        logger.warn({ uploadId, status }, "Conversation file held by virus scan");
    })
    .catch(async (error) => {
      logger.error({ err: error, uploadId }, "Virus scan crashed");
      await Upload.update({ id: uploadId }, { scanStatus: "error" }).catch(() => undefined);
    });
}

/** Upload ids among `ids` (of this org) whose scan is still pending. */
export async function pendingScans(organizationId: string, ids: string[]): Promise<string[]> {
  if (!ids.length || !isScanEnabled()) return [];
  const rows = await Upload.find({
    where: { id: In(ids), organizationId, scanStatus: "pending" },
    select: ["id"],
  });
  return rows.map((row) => row.id);
}

/** Wait until none of `ids` is pending (or the timeout), and return their statuses. */
export async function waitForScans(
  ids: string[],
  timeoutMs: number,
): Promise<Map<string, ScanStatus | null>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await Upload.find({ where: { id: In(ids) }, select: ["id", "scanStatus"] });
    const statuses = new Map(rows.map((row) => [row.id, row.scanStatus ?? null] as const));
    const pending = [...statuses.values()].some((status) => status === "pending");
    if (!pending || Date.now() >= deadline) return statuses;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
