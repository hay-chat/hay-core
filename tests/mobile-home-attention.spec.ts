import { test, expect, devices } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { Client } from "pg";

/**
 * Phone-sized happy path for the attention-first Home:
 *   open / on a phone → see the conversation waiting for a human → tap Take over
 *   → land in the conversation, which is now assigned to me.
 *
 * The dev stack may run on other ports than the config's baseURL (this host has
 * 3000/3001 taken); set E2E_BASE_URL to point at the dashboard. The global
 * setup writes the auth storage state for http://localhost:3000, so we re-home
 * it to that origin.
 *
 * Seeding goes through `pg` with plain SQL: Playwright's transpiler cannot load
 * TypeORM entity decorators, so importing AppDataSource from a spec fails.
 * Connection settings come from the repo-root .env, like the server's.
 */
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function getTestUserEmail(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `hay-e2e-${date}@test.com`;
}

function dbClient(): Client {
  return new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const AUTH_STATE = path.resolve(__dirname, "../playwright/.auth/user.json");
const MOBILE_AUTH_STATE = path.resolve(__dirname, "../playwright/.auth/user-mobile.json");

const phone = devices["Pixel 7"];

test.use({
  ...phone,
  baseURL: BASE_URL,
  storageState: MOBILE_AUTH_STATE,
});

// Pixel emulation (isMobile) is Chromium-only in Playwright
test.skip(({ browserName }) => browserName !== "chromium", "phone emulation needs Chromium");

const CUSTOMER_NAME = "Ana Souza (e2e)";
const SUMMARY = "Customer asks for a refund on order 1042; the item arrived damaged.";

let db: Client;
let userId: string;
let organizationId: string;
let conversationId: string;
let customerId: string;

test.beforeAll(async ({ browser }) => {
  // Re-home the saved auth state to the dashboard origin under test
  const state = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8"));
  for (const origin of state.origins ?? []) {
    origin.origin = BASE_URL;
    // Home redirects first-time users to Getting Started; this user has finished it
    origin.localStorage.push({
      name: "app",
      value: JSON.stringify({ onboardingCompleted: true }),
    });
  }
  fs.writeFileSync(MOBILE_AUTH_STATE, JSON.stringify(state));

  db = dbClient();
  await db.connect();

  const userRow = await db.query<{ id: string; organization_id: string }>(
    `SELECT id, organization_id FROM users WHERE email = $1`,
    [getTestUserEmail()],
  );
  if (userRow.rowCount === 0) throw new Error("E2E test user missing; global setup did not run");
  userId = userRow.rows[0].id;
  organizationId = userRow.rows[0].organization_id;

  const customer = await db.query<{ id: string }>(
    `INSERT INTO customers (organization_id, name, external_id) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, CUSTOMER_NAME, `e2e-${Date.now()}-${process.pid}`],
  );
  customerId = customer.rows[0].id;

  try {
    const conversation = await db.query<{ id: string }>(
      `INSERT INTO conversations
         (organization_id, customer_id, title, status, channel, summary, last_message_at)
       VALUES ($1, $2, $3, 'pending-human', 'web', $4, now() - interval '4 minutes')
       RETURNING id`,
      [organizationId, customerId, "Refund for order 1042", SUMMARY],
    );
    conversationId = conversation.rows[0].id;
  } catch (error) {
    await db.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    throw error;
  }

  // Warm up a cold Nuxt dev server: the first visit to each page discovers new
  // dependencies, Vite re-optimizes and force-reloads, which would fail the
  // assertions below with "Outdated Optimize Dep" errors.
  const warm = await browser.newPage({
    ...phone,
    baseURL: BASE_URL,
    storageState: MOBILE_AUTH_STATE,
  });
  for (const url of ["/", `/conversations/${conversationId}`, "/"]) {
    await warm.goto(url, { waitUntil: "networkidle", timeout: 120000 }).catch(() => undefined);
    await warm.waitForTimeout(2000);
  }
  await warm.close();
});

test.afterAll(async () => {
  if (!db) return;
  if (conversationId) {
    await db.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
  }
  if (customerId) {
    await db.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  }
  await db.end();
});

// One worker: both tests share the seeded conversation created in beforeAll
test.describe.configure({ mode: "serial" });

test.describe("Home on a phone", () => {
  test("shows who is waiting and takes the conversation over in one tap", async ({ page }) => {
    await page.goto("/");

    // Headline is the count of conversations waiting for a human
    const headline = page.getByTestId("home-headline");
    await expect(headline).toContainText(/waiting for a human/i, { timeout: 15000 });
    await expect(headline).not.toContainText(/^Nothing/);

    // The seeded conversation is in the waiting list with its summary
    const list = page.getByTestId("home-waiting-list");
    const row = list.locator("li", { hasText: CUSTOMER_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText(SUMMARY);
    await expect(row).toContainText(/Waiting \d+m/);

    // Phone chrome: top bar badge reflects the count; no horizontal overflow
    await expect(page.getByTestId("mobile-attention-badge")).toContainText(/[1-9]/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Take over button is thumb-sized and does the job in one tap
    const takeOver = row.getByTestId("home-take-over");
    const box = await takeOver.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await takeOver.tap();

    await expect(page).toHaveURL(new RegExp(`/conversations/${conversationId}$`), {
      timeout: 15000,
    });

    // Persisted: assigned to me, status flipped
    await expect
      .poll(
        async () => {
          const result = await db.query(
            `SELECT status, assigned_user_id FROM conversations WHERE id = $1`,
            [conversationId],
          );
          return result.rows[0];
        },
        { timeout: 10000 },
      )
      .toEqual({ status: "human-took-over", assigned_user_id: userId });

    // The detail page fits the phone too
    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(detailOverflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("conversation-details-toggle")).toBeVisible();

    // Back on Home, it moved from "waiting" to "you're handling"
    await page.goto("/");
    await expect(
      page.getByTestId("home-mine-list").locator("li", { hasText: CUSTOMER_NAME }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("opens the navigation drawer from the top bar", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mobile-menu-button").tap();

    const drawerLink = page.getByRole("link", { name: "Conversations" });
    await expect(drawerLink).toBeVisible();
    await drawerLink.tap();
    await expect(page).toHaveURL(/\/conversations$/);
  });
});
