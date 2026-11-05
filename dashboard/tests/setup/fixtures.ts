import type { SetupBoard, SetupRow } from "@/stores/setup";

export const row = (overrides: Partial<SetupRow> & Pick<SetupRow, "id" | "status">): SetupRow => ({
  text: `Question ${overrides.id}`,
  source: "catalog",
  sources: [],
  ...overrides,
});

export const board = (overrides: Partial<SetupBoard> = {}): SetupBoard => {
  const rows = overrides.rows ?? [];
  return {
    businessType: "store",
    website: "https://alma.example",
    toolPluginIds: [],
    channels: ["webchat"],
    rows,
    site: { state: "done", discovered: 42, processed: 42 },
    upNext: { kind: "done" },
    readyCount: rows.filter((r) => r.status === "ready").length,
    totalCount: rows.length,
    answeredAt: "2026-11-05T10:00:00.000Z",
    shouldPrompt: false,
    ...overrides,
  };
};

/** Mirrors the real `hasRouteAccess` for the routes setup links to. */
export const hasRouteAccess = (path: string, role: string | undefined): boolean => {
  const protectedRoutes: Record<string, string[]> = {
    "/setup": ["owner", "admin"],
    "/settings/webchat": ["owner", "admin"],
    "/integrations/plugins": ["owner", "admin"],
  };
  const match = Object.keys(protectedRoutes).find((route) => path.startsWith(route));
  return match ? protectedRoutes[match].includes(role ?? "") : true;
};
