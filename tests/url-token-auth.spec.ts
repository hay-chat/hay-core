import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

test.describe("URL Token Authentication", () => {
  test("should authenticate user with URL tokens and redirect to dashboard", async ({ page }) => {
    // Capture console logs to debug
    page.on("console", (msg) => {
      if (msg.text().includes("[Auth")) {
        console.log("Browser console:", msg.text());
      }
    });

    // Navigate with auth tokens via helper
    await navigateWithAuth(page, "/");

    // Should be authenticated and redirected to getting-started (new users need onboarding)
    await expect(page).toHaveURL(/\/(getting-started|dashboard)/, { timeout: 10000 });

    // Verify URL is clean (no tokens in URL)
    const url = new URL(page.url());
    expect(url.searchParams.has("accessToken")).toBe(false);
    expect(url.searchParams.has("refreshToken")).toBe(false);
    expect(url.searchParams.has("expiresIn")).toBe(false);

    // Verify user is authenticated by checking for user menu or similar element
    // Adjust selector based on your dashboard layout
    await expect(
      page
        .locator('[data-testid="user-menu"]')
        .or(page.locator('button:has-text("Settings")'))
        .or(page.locator("nav")),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should authenticate and navigate to specific path", async ({ page }) => {
    // Navigate directly to conversations page
    await navigateWithAuth(page, "/conversations");

    // Should be on conversations page
    await expect(page).toHaveURL(/\/conversations/, { timeout: 10000 });

    // Verify URL is clean
    const url = new URL(page.url());
    expect(url.searchParams.has("accessToken")).toBe(false);
    expect(url.searchParams.has("refreshToken")).toBe(false);
    expect(url.searchParams.has("expiresIn")).toBe(false);
  });

  test("should handle invalid tokens gracefully", async ({ page }) => {
    // Navigate with invalid tokens
    const invalidParams = new URLSearchParams({
      accessToken: "invalid-token",
      refreshToken: "invalid-refresh",
      expiresIn: "3600",
    });

    await page.goto(`/?${invalidParams.toString()}`);

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Should show error toast (if toast notifications are visible)
    // This is optional and depends on your toast implementation
  });
});
