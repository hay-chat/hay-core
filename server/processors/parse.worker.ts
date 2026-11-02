import { parentPort, workerData } from "node:worker_threads";
import { parseDocument } from "./parse-document";

/**
 * Worker thread entry for document parsing (see runWorker). Posts the parsed
 * document; a parser error surfaces as the worker's `error` event.
 */
const { bytes, mimeType, fileName } = workerData as {
  bytes: Uint8Array;
  mimeType: string;
  fileName?: string;
};

void parseDocument(
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  mimeType,
  fileName,
).then((processed) => parentPort!.postMessage(processed));
