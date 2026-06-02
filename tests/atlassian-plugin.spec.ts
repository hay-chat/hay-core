import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { navigateWithAuth } from "./helpers/login";

/**
 * Confluence Plugin E2E
 *
 * Drives the full Confluence document-importer flow against the REAL Atlassian
 * Cloud API using credentials supplied in `.env.test`. The token is read from
 * an out-of-tree file (also gitignored) so the secret never lands in CI logs.
 *
 * Required env vars (loaded by playwright.config.ts):
 *   CONFLUENCE_TEST_EMAIL     — Atlassian account email
 *   CONFLUENCE_TEST_SITE_URL  — e.g. https://your-team.atlassian.net
 *   CONFLUENCE_TEST_TOKEN_FILE — path to a file containing the API token only
 */

const EMAIL = process.env.CONFLUENCE_TEST_EMAIL!;
const SITE_URL = process.env.CONFLUENCE_TEST_SITE_URL!;
const TOKEN_FILE = process.env.CONFLUENCE_TEST_TOKEN_FILE!;

// We compute the token lazily inside tests (test.skip needs to run first so the
// suite is skipped cleanly when credentials are not set).
const haveCreds = Boolean(EMAIL && SITE_URL && TOKEN_FILE);
const TOKEN = haveCreds
  ? fs.readFileSync(path.resolve(process.cwd(), TOKEN_FILE), "utf8").trim()
  : "";

const TEST_DISPLAY_NAME = "Hay KB (test)";
const TARGET_SPACE_KEY = "XFLOW";
const TARGET_SPACE_NAME = "Hay Internal Knowledge Base";

// Shared between tests so the manual-sync test can find the source created by
// the headline test.
let createdSourceId: string | null = null;

/**
 * Fill the Confluence connect form on step 2 of /documents/import and submit.
 * Leaves the page on step 3 (space picker).
 */
async function fillConfluenceConnectForm(page: Page) {
  const card = page.locator('[data-testid="importer-card-hay-plugin-atlassian"]');
  await card.click();
  await page.getByRole("button", { name: /next/i }).click();

  // If the plugin is already connected (from a prior test in serial mode),
  // the wizard jumps straight to step 3 (space picker) and there is no
  // connect form to fill. Race the email field against the picker list — if
  // the picker shows first, we're done.
  const emailField = page
    .locator('[data-testid="hay-plugin-atlassian-email"]')
    .locator("input")
    .first();
  const pickerList = page.locator('[data-testid="space-picker-list"]');

  const winner = await Promise.race([
    emailField.waitFor({ state: "visible", timeout: 15_000 }).then(() => "form" as const),
    pickerList.waitFor({ state: "visible", timeout: 15_000 }).then(() => "picker" as const),
  ]);

  if (winner === "picker") {
    return; // already connected, picker is up
  }

  const siteField = page
    .locator('[data-testid="hay-plugin-atlassian-siteUrl"]')
    .locator("input")
    .first();
  const tokenField = page
    .locator('[data-testid="hay-plugin-atlassian-apiToken"]')
    .locator("input")
    .first();

  await emailField.fill(EMAIL);
  await siteField.fill(SITE_URL);
  await tokenField.fill(TOKEN);
  await page.locator('[data-testid="hay-plugin-atlassian-connect-submit"]').click();
}

test.describe.configure({ mode: "serial" });

test.describe("Atlassian plugin import flow (real API)", () => {
  test.beforeEach(async ({ page }) => {
    if (!haveCreds) {
      test.skip(true, "Confluence test credentials not configured (.env.test)");
    }
    // Suppress the document-import guided tour (Shepherd modal overlay
    // intercepts clicks on the importer cards).
    await page.addInitScript(() => {
      try {
        localStorage.setItem("hay-import-tour-seen", "true");
      } catch {
        /* ignore */
      }
    });
  });

  test("shows real Confluence spaces in the picker", async ({ page }) => {
    test.setTimeout(60_000);

    page.on("console", (msg) => {
      // Strip anything that might contain the token from console echo.
      const text = msg.text();
      if (text.includes(TOKEN)) return;
      console.log(`[browser:${msg.type()}]`, text);
    });

    await navigateWithAuth(page, "/documents/import");

    await fillConfluenceConnectForm(page);

    // Wait for the picker to populate. Real API call — give it some headroom.
    const list = page.locator('[data-testid="space-picker-list"]');
    await list.waitFor({ state: "visible", timeout: 30_000 });

    const rows = list.locator('[data-testid^="space-row-"]');
    await expect.poll(async () => rows.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

    // At least one of the expected Hay spaces should be present.
    const labels = await list.locator("p.text-sm.font-medium").allTextContents();
    const hasExpected = labels.some((label) =>
      /(Hay Internal Knowledge Base|Software Engineering|^Hay$|Hay )/i.test(label),
    );
    expect(hasExpected, `Expected at least one Hay space in: ${labels.join(", ")}`).toBe(true);
  });

  test("imports real pages from a Confluence space", async ({ page }) => {
    test.setTimeout(180_000); // 3 min: real network + indexing + embeddings

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes(TOKEN)) return;
      console.log(`[browser:${msg.type()}]`, text);
    });

    await navigateWithAuth(page, "/documents/import");

    await fillConfluenceConnectForm(page);

    // Step 3: space picker.
    const list = page.locator('[data-testid="space-picker-list"]');
    await list.waitFor({ state: "visible", timeout: 30_000 });

    // Try the XFLOW row first (most reliable id). Fall back to the row whose
    // label matches the human-readable space name.
    const byKey = list.locator(`[data-testid$="-${TARGET_SPACE_KEY}"]`);
    const byName = list.locator(`button:has-text("${TARGET_SPACE_NAME}")`);
    const targetRow = (await byKey.count()) > 0 ? byKey.first() : byName.first();
    await targetRow.waitFor({ state: "visible", timeout: 15_000 });
    await targetRow.click();

    // Override displayName to avoid colliding with prior runs in the same DB.
    const nameInput = page
      .locator('[data-testid="space-picker-display-name"]')
      .locator("input")
      .first();
    await nameInput.fill(TEST_DISPLAY_NAME);

    // Sync interval: leave at default ("manual") — picker renders it that way.
    // No explicit interaction needed unless we want a different cadence.

    // Submit. Two possible navigations:
    //   - /documents/sources/<id>   (preferred)
    //   - /documents?sourceCreated=<id>  (fallback when no redirect path set)
    await Promise.all([
      page.waitForURL(/\/documents(\/sources\/[^/]+|\?sourceCreated=[^&]+)/, {
        timeout: 60_000,
      }),
      page.locator('[data-testid="space-picker-submit"]').click(),
    ]);

    const finalUrl = page.url();
    const sourceMatch =
      finalUrl.match(/\/documents\/sources\/([0-9a-f-]+)/i) ||
      finalUrl.match(/sourceCreated=([0-9a-f-]+)/i);
    expect(
      sourceMatch,
      `URL after submit should reference the new source: ${finalUrl}`,
    ).not.toBeNull();
    createdSourceId = sourceMatch![1];
    console.log(`[confluence-e2e] Created document source id: ${createdSourceId}`);

    // Navigate to the documents list and poll for documents created by this
    // plugin import. The sync runs in the background; embeddings can take
    // a while. We wait up to ~90 s for at least one doc to appear.
    // Poll the documents tRPC route directly — the UI doesn't visually
    // distinguish plugin-imported docs, so DOM-based filtering is brittle.
    // We poll the API for documents tied to the created DocumentSource.
    let firstDocId = "";
    const ls = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        out[key] = localStorage.getItem(key) ?? "";
      }
      return out;
    });
    let bearer: string | undefined;
    let orgId: string | undefined;
    try {
      const auth = JSON.parse(ls["pinia:auth"] ?? "{}") as {
        tokens?: { accessToken?: string };
      };
      bearer = auth.tokens?.accessToken;
    } catch {
      /* ignore */
    }
    try {
      const userState = JSON.parse(ls["pinia:user"] ?? "{}") as {
        user?: { activeOrganizationId?: string };
      };
      orgId = userState.user?.activeOrganizationId;
    } catch {
      /* ignore */
    }
    console.log(`[confluence-e2e] bearer=${!!bearer} orgId=${!!orgId}`);

    await expect
      .poll(
        async () => {
          const input = encodeURIComponent(JSON.stringify({}));
          const headers: Record<string, string> = {};
          if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
          if (orgId) headers["x-organization-id"] = orgId;
          const resp = await page.request.get(
            `http://localhost:3001/v1/documents.list?input=${input}`,
            { headers },
          );
          if (!resp.ok()) return 0;
          const body = (await resp.json()) as {
            result?: {
              data?: { items?: Array<{ id: string; documentSourceId?: string }> };
            };
          };
          const list = body.result?.data?.items ?? [];
          const matched = list.filter((d) => d.documentSourceId === createdSourceId);
          if (matched.length > 0) firstDocId = matched[0].id;
          return matched.length;
        },
        { timeout: 120_000, intervals: [3_000, 5_000, 10_000] },
      )
      .toBeGreaterThanOrEqual(1);

    // Open the first plugin-imported document.
    await page.goto(`/documents/${firstDocId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForLoadState("networkidle");

    // Assert the body has rendered something more than the processing
    // placeholder. We accept either rendered markdown or a sufficiently long
    // string of non-PROCESSING text.
    const body = page.locator("article, [data-testid='document-content'], main");
    const bodyText = (await body.first().innerText()).trim();
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText.toUpperCase()).not.toBe("PROCESSING");

    await page.screenshot({
      path: "test-results/confluence-plugin-imported.png",
      fullPage: true,
    });
  });

  test("manual sync re-runs and updates lastSyncedAt", async ({ page }) => {
    test.setTimeout(120_000);

    if (!createdSourceId) {
      test.skip(true, "Skipping — headline import test did not create a source");
    }

    await navigateWithAuth(page, `/documents/sources/${createdSourceId}`);
    await page.waitForLoadState("networkidle");

    // Grab the "Last synced" timestamp before triggering a new sync. We read
    // it from the dd that follows "Last synced".
    const lastSyncedDt = page.locator("dt", { hasText: /last synced/i }).first();
    const beforeText = (
      await lastSyncedDt.locator("xpath=following-sibling::dd[1]").innerText()
    ).trim();

    // Click "Sync now"
    const syncButton = page.getByRole("button", { name: /sync now/i });
    await syncButton.click();

    // Status should transition: idle → running → (success|partial|idle).
    // We don't strictly require to see "running" since it can be fast; we
    // just wait for the "Last synced" text to change.
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.waitForLoadState("networkidle");
          const after = (
            await lastSyncedDt.locator("xpath=following-sibling::dd[1]").innerText()
          ).trim();
          return after !== beforeText && after.toLowerCase() !== "never";
        },
        { timeout: 90_000, intervals: [5_000, 10_000] },
      )
      .toBe(true);
  });

  // Best-effort cleanup: delete any document sources whose displayName starts
  // with our test prefix. Documents themselves are left in place (cheap).
  test.afterAll(async ({ browser }) => {
    if (!haveCreds) return;

    try {
      const context = await browser.newContext({
        storageState: "playwright/.auth/user.json",
      });
      const page = await context.newPage();

      // Hit the document sources page so the API is reachable. We then call
      // the same trpc procedures the dashboard uses via fetch in the page
      // context (this inherits the auth cookies / headers).
      await navigateWithAuth(page, "/documents/sources");

      // Use the page's Hay client by evaluating fetch against the API. The
      // simpler path is to navigate to each sources detail and let the user
      // delete them via UI, but we want this non-flaky and silent.
      const result = await page.evaluate(async (prefix: string) => {
        const res = await fetch("/v1/documentSources.list", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) return { ok: false, status: res.status };
        const body = await res.json();
        type Src = { id: string; displayName: string };
        const sources: Src[] = body?.result?.data?.sources ?? body?.result?.data ?? [];
        const toDelete = sources.filter((s) => s.displayName?.startsWith(prefix));
        const deleted: string[] = [];
        for (const src of toDelete) {
          const del = await fetch("/v1/documentSources.delete", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: src.id, deleteDocuments: true }),
          });
          if (del.ok) deleted.push(src.id);
        }
        return { ok: true, deleted };
      }, TEST_DISPLAY_NAME);

      console.log("[confluence-e2e] Cleanup result:", result);
      await context.close();
    } catch (err) {
      // Cleanup is best-effort; never fail the suite on cleanup errors.
      console.warn("[confluence-e2e] Cleanup failed (non-fatal):", err);
    }
  });
});
