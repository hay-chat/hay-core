import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { runIsolationChecks } from "../../plugin-host/isolation-check";
import {
  bwrapLauncher,
  probeBwrap,
  createUidLauncher,
  probeUidSeparation,
} from "../../plugin-host/launcher";

/**
 * These run a stand-in for a compromised plugin under each launcher. They need
 * Linux, the built server (`dist/plugin-host/isolation-probe-worker.js`) and, per
 * tier, bubblewrap with user namespaces (tier 1) or root with SETUID, SETGID,
 * CHOWN and SETPCAP (tier 2); otherwise that tier's tests are skipped. The
 * Docker run in SELF_HOSTING.md's "Plugin isolation" section exercises both.
 */
const rootDir = path.resolve(__dirname, "../../..");
const built = existsSync(path.join(rootDir, "server/dist/plugin-host/isolation-probe-worker.js"));
const isLinux = process.platform === "linux";
const hasBwrap =
  isLinux && built && spawnSync("bwrap", ["--version"]).status === 0 && probeBwrap() === null;
const isRoot = process.getuid?.() === 0;
const hasUidSeparation = isLinux && built && isRoot && probeUidSeparation() === null;

async function failedBoundaries(tier: number, launcher: Parameters<typeof runIsolationChecks>[0]) {
  const workers = mkdtempSync(path.join(os.tmpdir(), "hay-workers-"));
  try {
    const checks = await runIsolationChecks(launcher, rootDir, workers);
    return checks.filter((check) => check.tiers.includes(tier) && !check.ok);
  } finally {
    rmSync(workers, { recursive: true, force: true });
  }
}

describe("worker isolation", () => {
  (hasBwrap ? it : it.skip)(
    "tier 1 (bubblewrap): every boundary holds against a hostile worker",
    async () => {
      expect(await failedBoundaries(1, bwrapLauncher)).toEqual([]);
    },
  );

  (hasUidSeparation ? it : it.skip)(
    "tier 2 (one user per worker): workers cannot reach each other",
    async () => {
      expect(await failedBoundaries(2, createUidLauncher(10001))).toEqual([]);
    },
  );
});
