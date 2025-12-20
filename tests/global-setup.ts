import "reflect-metadata";
import { FullConfig } from "@playwright/test";
import { AppDataSource } from "../server/database/data-source";
import {
  cleanupTestUsers,
  createTestUser,
  generateAuthState,
  getTestUserEmail,
  getTestOrgName,
  TEST_PASSWORD,
} from "./helpers/auth";
import * as fs from "fs";
import * as path from "path";

const AUTH_STATE_PATH = "playwright/.auth/user.json";

async function globalSetup(config: FullConfig) {
  console.log("🧪 [E2E Setup] Starting global setup...");

  // 1. Initialize database connection
  if (!AppDataSource.isInitialized) {
    console.log("🔄 [E2E Setup] Connecting to database...");
    await AppDataSource.initialize();
    console.log("✅ [E2E Setup] Database connected");
  }

  try {
    // 2. Cleanup old test users
    console.log("🧹 [E2E Setup] Cleaning up old test users...");
    await cleanupTestUsers();
    console.log("   ✅ Old test users cleaned up");

    // 3. Create test user + organization
    console.log("👤 [E2E Setup] Creating test user and organization...");
    const testEmail = getTestUserEmail();
    const testOrgName = getTestOrgName();

    const { user, organization, tokens } = await createTestUser();

    console.log(`   ✅ Created organization: ${testOrgName}`);
    console.log(`   ✅ Created user: ${testEmail}`);
    console.log("   ✅ Created UserOrganization entry");

    // 4. Generate storage state
    console.log("💾 [E2E Setup] Creating storage state...");
    const authStateDir = path.dirname(AUTH_STATE_PATH);
    if (!fs.existsSync(authStateDir)) {
      fs.mkdirSync(authStateDir, { recursive: true });
    }

    const storageState = generateAuthState(tokens, user, organization);

    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(storageState, null, 2));
    console.log(`   ✅ Storage state saved to ${AUTH_STATE_PATH}`);

    // 5. Log success summary
    console.log("\n✨ [E2E Setup] Global setup completed successfully!");
    console.log(`   Email: ${testEmail}`);
    console.log(`   Password: ${TEST_PASSWORD}`);
    console.log(`   Organization: ${testOrgName}`);
    console.log(`   Access Token: ${tokens.accessToken.substring(0, 20)}...`);
    console.log("");
  } catch (error) {
    console.error("❌ [E2E Setup] Global setup failed:", error);
    throw error;
  } finally {
    // Don't close database connection - tests will use it
  }
}

export default globalSetup;
