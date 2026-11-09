/**
 * Picks the strongest isolation the host allows, once, at start-up.
 *
 * 1. bubblewrap: a sandbox per worker (needs unprivileged user namespaces).
 * 2. one user id per worker (needs the supervisor to start as root with
 *    SETUID, SETGID, CHOWN and SETPCAP).
 * 3. nothing between plugins, only the plugin-host container around them.
 *
 * A supervisor that starts as root only ever uses tier 2: bubblewrap would run
 * the workers as root.
 */
import {
  createUidLauncher,
  probeBwrap,
  probeUidSeparation,
  bwrapLauncher,
  sameUidLauncher,
} from "./launcher";
import type { Launcher } from "./launcher";

export interface Detection {
  launcher: Launcher;
  /** Why a stronger tier was not used; null when the best tier was. */
  reason: string | null;
}

export function detectLauncher(coreGid: number): Detection {
  if (process.getuid?.() === 0) {
    const failure = probeUidSeparation();
    if (failure) {
      throw new Error(
        `The plugin host runs as root but cannot start workers as other users (${failure}). ` +
          "Add cap_add SETUID, SETGID, CHOWN, SETPCAP, or run it as the default user.",
      );
    }
    // Directories shared with core belong to core's group; the supervisor must be in it.
    process.setgroups?.([coreGid]);
    return {
      launcher: createUidLauncher(coreGid),
      reason:
        "the plugin host runs as root (selfhost/plugin-host-uid.yml), so bubblewrap is not used",
    };
  }
  const failure = probeBwrap();
  if (failure === null) return { launcher: bwrapLauncher, reason: null };
  return { launcher: sameUidLauncher, reason: `bubblewrap failed: ${failure}` };
}
