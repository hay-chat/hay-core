/**
 * The evidence ZIP (D2-5): evidence.pdf, the stored attachments, README.txt
 * (what is inside and that Hay.chat generated it) and manifest.json with the
 * SHA-256 of every other file.
 */
import { createHash } from "crypto";
import * as archiver from "archiver";
import { formatZonedDateTime } from "@server/utils/zoned-datetime";
import { evidenceCopy, fillCopy, type EvidenceTemplate } from "./copy";
import type { EvidenceResult } from "./dispute-evidence.service";

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

/** A file name safe inside a ZIP on any OS. */
function safeName(name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function buildEvidenceZip(
  result: EvidenceResult,
  meta: { timeZone: string; template: EvidenceTemplate; orderLabel: string | null },
): Promise<Buffer> {
  const copy = evidenceCopy(result.locale);
  const at = formatZonedDateTime(result.generatedAt, meta.timeZone);
  const readme = Buffer.from(
    copy.readme.map((line) => fillCopy(line, { at, store: result.storeName })).join("\n") + "\n",
    "utf8",
  );
  const files: Array<{ path: string; buffer: Buffer }> = [
    { path: "evidence.pdf", buffer: result.pdf },
    ...result.attachments.map((item, index) => ({
      path: `attachments/${String(index + 1).padStart(2, "0")}-${safeName(
        item.attachment.name ?? "",
        item.attachment.id,
      )}`,
      buffer: item.buffer,
    })),
    { path: "README.txt", buffer: readme },
  ];
  const manifest = {
    generatedBy: "Hay.chat",
    generatedAt: result.generatedAt.toISOString(),
    store: result.storeName,
    order: meta.orderLabel,
    template: meta.template,
    conversationIds: result.conversationIds,
    algorithm: "SHA-256",
    files: files.map((file) => ({
      path: file.path,
      bytes: file.buffer.length,
      sha256: sha256(file.buffer),
    })),
  };

  const archive = archiver.default("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const file of files) archive.append(file.buffer, { name: file.path });
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  await archive.finalize();
  return done;
}
