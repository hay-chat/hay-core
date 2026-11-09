#!/usr/bin/env node
// Fails on any moderate-or-worse advisory in production dependencies unless it
// is listed in .github/audit-allowlist.json. Usage: audit-check.mjs <directory>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.argv[2] ?? ".";
const allowlistPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.github/audit-allowlist.json",
);
const today = new Date().toISOString().slice(0, 10);
const allowlist = new Map(
  JSON.parse(readFileSync(allowlistPath, "utf8")).advisories.map((entry) => [entry.id, entry]),
);

// npm audit exits non-zero when it finds anything; the JSON decides here.
const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  cwd: directory,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  report = {};
}
if (!report.vulnerabilities) {
  console.error(`npm audit returned no report for ${directory}:\n${audit.stdout}${audit.stderr}`);
  process.exit(1);
}

const advisories = new Map();
for (const { name, via } of Object.values(report.vulnerabilities)) {
  for (const entry of via) {
    // A string entry only points at another vulnerable package.
    if (typeof entry === "string") continue;
    const id = entry.url.split("/").pop();
    advisories.set(id, { id, name, severity: entry.severity, title: entry.title });
  }
}

const failures = [];
const accepted = [];
for (const advisory of advisories.values()) {
  if (advisory.severity === "low" || advisory.severity === "info") continue;
  const entry = allowlist.get(advisory.id);
  const line = `${advisory.severity} ${advisory.name} ${advisory.id}: ${advisory.title}`;
  if (advisory.severity !== "moderate" || !entry) failures.push(line);
  else if (entry.expires < today) failures.push(`${line} (allowlist entry expired ${entry.expires})`);
  else accepted.push(`${line} (accepted until ${entry.expires})`);
}

accepted.forEach((line) => console.log(`allowed: ${line}`));
if (failures.length > 0) {
  failures.forEach((line) => console.error(`blocked: ${line}`));
  process.exit(1);
}
console.log(`npm audit passed for ${directory}`);
