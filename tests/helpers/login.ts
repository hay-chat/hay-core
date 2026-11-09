import type { Page } from "@playwright/test";

// Test credentials - match what global-setup creates
const TEST_PASSWORD = "E2eTest@123456";
const DASHBOARD_URL = process.env.PLAYWRIGHT_DASHBOARD_URL ?? "http://localhost:3000";
const SERVER_URL = process.env.PLAYWRIGHT_SERVER_URL ?? "http://localhost:3001";

function getTestUserEmail(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `hay-e2e-${date}@test.com`;
}

/** POST to a tRPC procedure on the test server and unwrap its result. */
async function callProcedure<T>(
  procedure: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${SERVER_URL}/v1/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${procedure} failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.result.data as T;
}

/**
 * Log in through the API, hand the browser a single-use code on /auth/exchange,
 * then open `path`. The test server needs the dashboard origin in
 * CONNECT_ALLOWED_REDIRECT_ORIGINS for the code to be issued.
 */
export async function navigateWithAuth(page: Page, path: string = "/"): Promise<void> {
  const { accessToken } = await callProcedure<{ accessToken: string }>("auth.login", {
    email: getTestUserEmail(),
    password: TEST_PASSWORD,
  });

  const { code } = await callProcedure<{ code: string }>(
    "auth.generateAuthCode",
    { redirectUri: DASHBOARD_URL },
    { Authorization: `Bearer ${accessToken}` },
  );

  await page.goto(`${DASHBOARD_URL}/auth/exchange?code=${encodeURIComponent(code)}`);
  await page.waitForURL((url) => url.pathname !== "/auth/exchange");

  await page.goto(`${DASHBOARD_URL}${path}`);
  await page.waitForLoadState("networkidle");
}
