#!/usr/bin/env node
// Widget performance budget (D12-9). Runs against a fresh `npm run build`,
// without Chrome, and exits 1 when a budget is exceeded:
//
// 1. Size: brotli (and gzip) size of widget.js (the loader every page loads),
//    the chat chunk and the largest locale chunk.
// 2. Requests: widget.js runs in jsdom with a counting fetch/XHR/WebSocket/
//    import(). In `loading: "interaction"` mode nothing may be requested before
//    the visitor reaches for the button; in the default `idle` mode only the
//    settings call may run before the page is idle.
//
// Usage: npm run build && npm run check:perf
// For page-level numbers in real Chrome see scripts/perf/lighthouse.mjs.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const KB = 1024;

// Budgets in brotli bytes at quality 5, what the server sends on the wire
// (server/lib/http-compression.ts).
// Raise one only on purpose, in the same commit as the change that needs it.
const BUDGETS = {
  loader: 10 * KB, // widget.js, on every page view
  chat: 48 * KB, // Vue + chat window, loaded when idle or on intent
  locale: 2 * KB, // one locale chunk, loaded with the chat
};

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`FAIL ${message}`);
};
const pass = (message) => console.log(`ok   ${message}`);

// --- 1. Sizes ---------------------------------------------------------------

function sizes(file) {
  const raw = fs.readFileSync(file);
  return {
    raw: raw.length,
    gzip: zlib.gzipSync(raw, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(raw, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    }).length,
  };
}

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

function checkSize(label, file, budget) {
  const s = sizes(file);
  const line = `${label.padEnd(7)} ${path.relative(dist, file).padEnd(28)} raw ${kb(s.raw).padStart(9)}  gzip ${kb(s.gzip).padStart(8)}  brotli ${kb(s.brotli).padStart(8)}  budget ${kb(budget)}`;
  if (s.brotli > budget) fail(line);
  else pass(line);
  return s;
}

const loaderFile = path.join(dist, "widget.js");
const manifestFile = path.join(dist, ".vite/manifest.json");
if (!fs.existsSync(loaderFile) || !fs.existsSync(manifestFile)) {
  console.error("dist/widget.js or the chat manifest is missing: run `npm run build` first.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const chatEntry = Object.values(manifest).find((chunk) => chunk.isEntry);
const localeFiles = fs
  .readdirSync(path.join(dist, "assets"))
  .filter((name) => /^[a-z]{2}-[a-z]{2}-.*\.js$/.test(name))
  .map((name) => path.join(dist, "assets", name));

console.log("Widget size (brotli budgets)");
const loader = checkSize("loader", loaderFile, BUDGETS.loader);
const chat = checkSize("chat", path.join(dist, chatEntry.file), BUDGETS.chat);
const largestLocale = localeFiles
  .map((file) => ({ file, brotli: sizes(file).brotli }))
  .sort((a, b) => b.brotli - a.brotli)[0];
const locale = largestLocale
  ? checkSize("locale", largestLocale.file, BUDGETS.locale)
  : { brotli: 0 };
console.log(
  `     first open downloads ${kb(loader.brotli + chat.brotli + locale.brotli)} brotli in total (loader + chat + one locale)`,
);

// --- 2. Requests before interaction -------------------------------------------

const loaderSource = fs.readFileSync(loaderFile, "utf8");

/**
 * Run widget.js on an empty page in `mode`, wait `waitMs` after the load event
 * and return what it tried to fetch. `interact` then hovers the button and
 * reports what that triggered, which proves the counters see real requests.
 */
async function observeRequests(mode, waitMs) {
  const requests = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", (...args) => {
    // jsdom's vm has no module loader, so the chunk import() rejects; the loader
    // logs that. Count it as the chunk request it is.
    if (String(args[0]).includes("Failed to load the chat")) requests.push("import(chat chunk)");
  });

  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
     <script>window.HayChat={config:{organizationId:"budget-check",baseUrl:"https://hay.invalid",loading:${JSON.stringify(mode)}}};</script>
     </body></html>`,
    {
      url: "https://store.example/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        window.fetch = async (input) => {
          requests.push(`fetch ${String(input).split("?")[0]}`);
          return new window.Response(JSON.stringify({ result: { data: { enabled: true } } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        };
        window.XMLHttpRequest.prototype.open = function (method, url) {
          requests.push(`xhr ${url}`);
        };
        window.WebSocket = function (url) {
          requests.push(`websocket ${url}`);
        };
        window.navigator.sendBeacon = (url) => {
          requests.push(`beacon ${url}`);
          return true;
        };
        // Elements that would fetch something: scripts, styles, images, frames.
        new window.MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes) {
              const url = node.src || (node.rel === "stylesheet" && node.href);
              if (url) requests.push(`${node.tagName.toLowerCase()} ${url}`);
            }
        }).observe(window.document, { childList: true, subtree: true });
      },
    },
  );
  const { window } = dom;
  // jsdom has no Response in older versions; the loader only uses ok/json().
  if (!window.Response) {
    window.Response = class {
      constructor(body, init) {
        this.ok = true;
        this.status = init.status;
        this.body = body;
      }
      async json() {
        return JSON.parse(this.body);
      }
    };
  }

  const script = window.document.createElement("script");
  script.textContent = loaderSource;
  window.document.body.appendChild(script);

  await new Promise((resolve) =>
    window.document.readyState === "complete"
      ? resolve()
      : window.addEventListener("load", resolve, { once: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const beforeInteraction = [...requests];

  const button = window.document.querySelector("button.hay-chat-button");
  button?.dispatchEvent(new window.Event("pointerenter"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterInteraction = requests.slice(beforeInteraction.length);

  window.close();
  return { button: Boolean(button), beforeInteraction, afterInteraction };
}

console.log("\nRequests before interaction");

// The idle fallback fires 1.5 s after load (no requestIdleCallback in jsdom),
// so wait past it in interaction mode to be sure nothing is scheduled.
const interaction = await observeRequests("interaction", 2000);
if (!interaction.button) fail("interaction: the launcher button was not painted");
else if (interaction.beforeInteraction.length > 0)
  fail(
    `interaction: ${interaction.beforeInteraction.length} request(s) before interaction (budget 0): ${interaction.beforeInteraction.join(", ")}`,
  );
else pass("interaction: 0 requests before interaction (budget 0)");
if (interaction.afterInteraction.length === 0)
  fail("interaction: hovering the button requested nothing, so the request counter is not working");
else
  pass(
    `interaction: hovering the button starts loading (${interaction.afterInteraction.join(", ")})`,
  );

// Idle: only the settings call may run before the browser is idle.
const idle = await observeRequests("idle", 0);
const idleBefore = idle.beforeInteraction.filter((r) => !r.includes("getPublicConfig"));
if (!idle.button) fail("idle: the launcher button was not painted");
else if (idleBefore.length > 0)
  fail(`idle: requests other than the settings call before idle: ${idleBefore.join(", ")}`);
else
  pass(
    `idle: only the settings call before the page is idle (${idle.beforeInteraction.length} request)`,
  );

if (failed) {
  console.error("\nWidget performance budget exceeded (webchat/scripts/check-perf.mjs).");
  process.exit(1);
}
console.log("\nWidget performance budget met.");
