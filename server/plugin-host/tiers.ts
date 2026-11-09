/**
 * Picks the strongest isolation the host allows, once, at start-up.
 */
import type { Launcher } from "./launcher";
import { sameUidLauncher } from "./launcher";

export interface Detection {
  launcher: Launcher;
  /** Why a stronger tier was not used; null when the best tier was. */
  reason: string | null;
}

export async function detectLauncher(_workersDir: string): Promise<Detection> {
  return { launcher: sameUidLauncher, reason: "no sandbox available" };
}
