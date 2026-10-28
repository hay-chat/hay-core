/**
 * iPhone and iPad only get push alerts from Hay.chat once it is added to the
 * Home Screen and opened from there (iOS 16.4+). True when this is an iOS
 * browser tab, so the dashboard can show the "Add to Home Screen" steps.
 */
export interface InstallEnvironment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** Safari's navigator.standalone: true when opened from the Home Screen icon */
  standalone?: boolean;
  /** matchMedia("(display-mode: standalone)").matches */
  displayStandalone?: boolean;
}

export function needsIosInstall(env: InstallEnvironment): boolean {
  const ios =
    /iPhone|iPad|iPod/i.test(env.userAgent) ||
    // iPadOS reports itself as a Mac; a touch screen gives it away
    (env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1);
  return ios && env.standalone !== true && env.displayStandalone !== true;
}

/** The browser's own environment (false on the server). */
export function browserNeedsIosInstall(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return needsIosInstall({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayStandalone: window.matchMedia?.("(display-mode: standalone)").matches,
  });
}
