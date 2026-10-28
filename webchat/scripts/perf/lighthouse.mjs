#!/usr/bin/env node
// Optional page-level check (D12-9): Lighthouse on a test product page, with
// and without the locally built widget, in each loading mode. Needs Google
// Chrome and network access for `npx lighthouse`; not run in CI (see
// scripts/check-perf.mjs for the Chrome-free budget that is).
//
// Usage (after `npm run build`):
//   node scripts/perf/lighthouse.mjs            # 5 runs per variant
//   RUNS=9 node scripts/perf/lighthouse.mjs
//   CHROME_PATH=/path/to/chrome node scripts/perf/lighthouse.mjs
//
// Method (same as the public "Widget performance" page on hay.chat):
// Lighthouse 12.8.2, mobile emulation with its default simulated throttling
// (Moto G Power, slow 4G, 4x CPU), performance category only, medians of the
// runs. Lighthouse runs with its own user agent: the widget never skips
// loading for speed tools.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const RUNS = Number(process.env.RUNS ?? 5);
const LIGHTHOUSE = "lighthouse@12.8.2";
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

if (!fs.existsSync(path.join(dist, "widget.js"))) {
  console.error("dist/widget.js is missing: run `npm run build` first.");
  process.exit(1);
}

// A plain product page: header, heading, button and 12 paragraphs.
const paragraphs = Array.from(
  { length: 12 },
  (_, i) =>
    `<p>Paragraph ${i}. Breathable washed linen, relaxed fit, mother-of-pearl buttons. Machine wash cold, line dry. Ships in 2-3 business days, free returns within 30 days.</p>`,
).join("");

function page(embed) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Store - Linen Shirt</title><meta name="description" content="Widget weight test page">
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#222;background:#fff}header{padding:12px 16px;border-bottom:1px solid #eee;font-weight:700}
main{max-width:960px;margin:0 auto;padding:16px}h1{font-size:28px;margin:16px 0 8px}.price{font-size:22px;margin:0 0 12px}
button.buy{background:#111;color:#fff;border:0;padding:14px 20px;border-radius:6px;font-size:16px;width:100%}p{line-height:1.6}</style></head><body>
<header>Test Store</header><main><h1>Washed Linen Shirt</h1><p class="price">EUR 59.00</p><button class="buy">Add to cart</button>${paragraphs}</main>
${embed}</body></html>`;
}

function embed(loading) {
  const config = {
    organizationId: "perf-test",
    baseUrl: "",
    position: "right",
    theme: "blue",
    showGreeting: true,
    loading,
  };
  return `<script>window.HayChat={config:Object.assign(${JSON.stringify(config)},{baseUrl:location.origin})};</script>
<script src="/v1/webchat/widget.js" async></script>`;
}

const variants = {
  control: page(""),
  idle: page(embed("idle")),
  eager: page(embed("eager")),
  interaction: page(embed("interaction")),
};

// Serves the pages, the built widget (brotli, like server/lib/http-compression)
// and a stub of the settings call.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (status, type, body) => {
    const compressed = zlib.brotliCompressSync(body, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Encoding": "br",
      "Cache-Control": "no-store",
    });
    res.end(compressed);
  };
  const name = url.pathname.slice(1).replace(/\.html$/, "");
  if (variants[name]) return send(200, "text/html; charset=utf-8", variants[name]);
  if (url.pathname === "/v1/webchat.getPublicConfig")
    return send(200, "application/json", JSON.stringify({ result: { data: { enabled: true } } }));
  if (url.pathname.startsWith("/v1/webchat/")) {
    const file = path.join(dist, url.pathname.slice("/v1/webchat/".length));
    if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile())
      return send(200, "text/javascript", fs.readFileSync(file));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hay-lighthouse-"));
const rows = [];
try {
  for (const name of Object.keys(variants)) {
    const results = [];
    for (let i = 1; i <= RUNS; i++) {
      const out = path.join(tmp, `${name}_${i}.json`);
      const args = [
        "--yes",
        LIGHTHOUSE,
        `${origin}/${name}.html`,
        "--quiet",
        "--only-categories=performance",
        "--chrome-flags=--headless=new --no-first-run --disable-extensions",
        "--output=json",
        `--output-path=${out}`,
      ];
      await run("npx", args, { maxBuffer: 64 * 1024 * 1024 });
      const report = JSON.parse(fs.readFileSync(out, "utf8"));
      if (report.runtimeError) throw new Error(`${name}: ${report.runtimeError.code}`);
      const audits = report.audits;
      const widget = (audits["network-requests"].details?.items ?? []).filter(
        (item) => /\/v1\/webchat/.test(item.url) && !item.url.endsWith(".map"),
      );
      results.push({
        score: Math.round(report.categories.performance.score * 100),
        fcp: audits["first-contentful-paint"].numericValue,
        lcp: audits["largest-contentful-paint"].numericValue,
        tbt: audits["total-blocking-time"].numericValue,
        cls: audits["cumulative-layout-shift"].numericValue,
        widgetKb: widget.reduce((sum, item) => sum + (item.transferSize ?? 0), 0) / 1024,
        widgetRequests: widget.length,
      });
      process.stdout.write(".");
    }
    const m = (key) => median(results.map((r) => r[key]));
    rows.push([
      name,
      m("score"),
      Math.round(m("fcp")),
      Math.round(m("lcp")),
      Math.round(m("tbt")),
      m("cls").toFixed(3),
      m("widgetKb").toFixed(1),
      m("widgetRequests"),
    ]);
  }
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n\nLighthouse 12.8.2, mobile, simulated throttling, median of ${RUNS} runs\n`);
const header = ["variant", "score", "FCP ms", "LCP ms", "TBT ms", "CLS", "widget KB", "widget req"];
console.log(header.join("\t"));
for (const row of rows) console.log(row.join("\t"));
console.log(
  "\n(widget KB and requests count everything under /v1/webchat, including widget.js and the settings call)",
);
