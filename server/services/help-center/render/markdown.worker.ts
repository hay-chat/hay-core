import { parentPort, workerData } from "node:worker_threads";
import { Marked } from "marked";

/**
 * Worker thread entry for turning article markdown into HTML (see
 * article-body.ts). Posts the unsanitised HTML; the caller sanitises it.
 */
const { content } = workerData as { content: string };

parentPort!.postMessage(new Marked({ gfm: true }).parse(content, { async: false }));
