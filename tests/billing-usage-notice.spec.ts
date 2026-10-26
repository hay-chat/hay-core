import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

/**
 * Usage notices pushed by the billing operator (hay-backoffice) through
 * `internal.organizations.setAccessState` must show up as the dashboard banner
 * with the translated copy, and an `agentPause` must reach `auth.me`.
 *
 * Requires the server to run with INTERNAL_API_SECRET set and the same value in
 * `.env.test`; the suite is skipped otherwise so it never fails for a missing
 * secret.
 */

const API_URL = "http://localhost:3001/v1";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";
const TEST_PASSWORD = "E2eTest@123456";

function testUserEmail(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `hay-e2e-${date}@test.com`;
}

async function trpc<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${API_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  return json.result.data as T;
}

async function trpcGet<T>(path: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(`${API_URL}/${path}`, { headers });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  return json.result.data as T;
}

async function loginAsTestUser(): Promise<{ accessToken: string; organizationId: string }> {
  const login = await trpc<{ accessToken: string }>("auth.login", {
    email: testUserEmail(),
    password: TEST_PASSWORD,
  });
  const me = await trpcGet<{ activeOrganizationId?: string; organizations: { id: string }[] }>(
    "auth.me",
    { Authorization: `Bearer ${login.accessToken}` },
  );
  const organizationId = me.activeOrganizationId ?? me.organizations[0]?.id;
  if (!organizationId) throw new Error("test user has no organization");
  return { accessToken: login.accessToken, organizationId };
}

function setAccessState(organizationId: string, input: Record<string, unknown>) {
  return trpc(
    "internal.organizations.setAccessState",
    { organizationId, suspension: null, agentPause: null, notice: null, ...input },
    { "x-hay-internal-secret": INTERNAL_SECRET },
  );
}

test.describe("billing usage notices", () => {
  test.skip(!INTERNAL_SECRET, "INTERNAL_API_SECRET not set in .env.test");

  let organizationId = "";
  let accessToken = "";

  test.beforeAll(async () => {
    ({ organizationId, accessToken } = await loginAsTestUser());
  });

  test.afterEach(async () => {
    // Always leave the test organization active and notice-free.
    await setAccessState(organizationId, {});
  });

  test("shows the 80 % usage warning banner with the translated copy", async ({ page }) => {
    await setAccessState(organizationId, {
      notice: {
        key: "usage_warning",
        level: "warning",
        params: { percent: 80, used: 400, included: 500 },
      },
    });

    await navigateWithAuth(page, "/conversations");

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("80% of your 500 included resolutions");
    await expect(banner).toContainText("400 so far");
  });

  test("shows the paused-agent notice with its CTA and exposes the pause via auth.me", async ({
    page,
  }) => {
    await setAccessState(organizationId, {
      agentPause: { reason: "usage_limit" },
      notice: {
        key: "usage_paused",
        level: "critical",
        params: { included: 500, periodEnd: "30 Nov 2026" },
        ctaUrl: "https://hay.chat/billing/",
        ctaLabel: "Manage usage",
      },
    });

    const me = await trpcGet<{
      organizations: {
        id: string;
        agentPausedAt: string | null;
        agentPauseReason: string | null;
      }[];
    }>("auth.me", { Authorization: `Bearer ${accessToken}` });
    const organization = me.organizations.find((org) => org.id === organizationId);
    expect(organization?.agentPausedAt).toBeTruthy();
    expect(organization?.agentPauseReason).toBe("usage_limit");

    await navigateWithAuth(page, "/conversations");

    const banner = page.getByRole("status");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Your AI agent is paused");
    await expect(banner).toContainText("30 Nov 2026");
    await expect(banner.getByRole("button", { name: "Manage usage" })).toBeVisible();
  });

  test("hides the banner again once the operator clears the notice", async ({ page }) => {
    await setAccessState(organizationId, {
      notice: {
        key: "usage_exceeded",
        level: "warning",
        params: { included: 500, periodEnd: "30 Nov 2026", rate: "€0.25" },
      },
    });
    await navigateWithAuth(page, "/conversations");
    await expect(page.getByRole("status")).toContainText("all 500 included resolutions");

    await setAccessState(organizationId, {});
    // The server pushes the new state over WebSocket; the banner must go away without a reload.
    await expect(page.getByRole("status")).toBeHidden({ timeout: 10_000 });
  });
});
