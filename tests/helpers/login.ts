import type { Page } from "@playwright/test";

// Test credentials - match what global-setup creates
const TEST_PASSWORD = "E2eTest@123456";

function getTestUserEmail(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `hay-e2e-${date}@test.com`;
}

/**
 * Login via API and navigate to page with auth token
 * Calls the login API to get a fresh token, then uses URL token auth
 */
export async function navigateWithAuth(page: Page, path: string = "/"): Promise<void> {
  const email = getTestUserEmail();
  const password = TEST_PASSWORD;

  console.log(`[Login Helper] Logging in as ${email}...`);

  // Call login API to get access token
  const response = await fetch("http://localhost:3001/v1/auth.login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Login failed: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  // tRPC response wraps in { result: { data: ... } }
  // The actual login result has: { accessToken, refreshToken, expiresIn, user }
  const result = data.result.data;
  const { accessToken, refreshToken, expiresIn } = result;

  console.log(`[Login Helper] Login successful, navigating to ${path} with full token set`);

  // Navigate with full token set - middleware uses loginWithTokens for complete auth
  const params = new URLSearchParams({
    accessToken,
    refreshToken,
    expiresIn: expiresIn.toString(),
  });

  await page.goto(`${path}?${params.toString()}`);
  await page.waitForLoadState("networkidle");

  console.log(`[Login Helper] ✅ Authenticated and navigated to ${path}`);
}
