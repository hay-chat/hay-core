# E2E Testing Guide

## Overview

This project uses Playwright for end-to-end testing with automatic authentication. Tests leverage storage state to authenticate once and reuse credentials across all tests, making them faster and more reliable.

## Quick Start

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/plugin-health-check.spec.ts

# Run with UI mode (interactive)
npx playwright test --ui

# Run specific browser
npx playwright test --project=chromium
npx playwright test --project=webkit

# Run in headed mode (see browser)
npx playwright test --headed

# Debug tests
npx playwright test --debug
```

## Authentication System

### Automated Tests (Storage State)

Tests automatically authenticate using saved auth state. No manual login required.

**How it works:**
1. **Global setup** creates a test user before tests run
2. Auth state saved to `playwright/.auth/user.json`
3. All tests load this auth state automatically
4. Tests can navigate directly to protected pages

**Test user credentials:**
- **Email**: `hay-e2e-YYYYMMDD@test.com` (date-based, e.g., `hay-e2e-20251220@test.com`)
- **Password**: `E2eTest@123456`
- **Role**: Owner
- **Organization**: `E2E Test Org YYYYMMDD`

### Manual Browser Access (URL Token Auth)

For debugging with Playwright MCP or manual testing:

1. **Extract access token** from storage state file:
   ```bash
   cat playwright/.auth/user.json | grep accessToken
   ```

2. **Navigate with token parameter**:
   ```
   http://localhost:3000/?auth_token=YOUR_ACCESS_TOKEN
   ```

3. Browser validates token and logs you in automatically

**Security notes:**
- Only works in development (`NODE_ENV !== 'production'`)
- Token removed from URL after validation
- Tokens expire after 15 minutes (JWT default)

**Example:**
```bash
# Extract token (macOS)
TOKEN=$(cat playwright/.auth/user.json | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# Open browser with auth
open "http://localhost:3000/?auth_token=$TOKEN"
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from "@playwright/test";

test("My test", async ({ page }) => {
  // Navigate directly - auth already loaded from storage state
  await page.goto("/plugins");

  // Your test assertions
  await expect(page.locator("h1")).toContainText("Plugins");
});
```

### Best Practices

1. **Use relative URLs** (baseURL configured):
   ```typescript
   await page.goto("/plugins");  // ✅ Good
   await page.goto("http://localhost:3000/plugins");  // ❌ Verbose
   ```

2. **No manual login** - Auth state handles this automatically

3. **Wait for network idle** when page has dynamic content:
   ```typescript
   await page.goto("/plugins");
   await page.waitForLoadState("networkidle");
   ```

4. **Use semantic selectors** for resilient tests:
   ```typescript
   page.getByRole("button", { name: "Save" })  // ✅ Good
   page.locator("button.btn-primary")  // ❌ Fragile
   ```

5. **Set appropriate timeouts**:
   ```typescript
   test.setTimeout(30000);  // 30 seconds for slow operations
   ```

## Test Organization

### Test Files

- [tests/plugin-health-check.spec.ts](../tests/plugin-health-check.spec.ts) - Plugin connection status tests
- [tests/instructions-editor.spec.ts](../tests/instructions-editor.spec.ts) - Instructions editor functionality
- [tests/instructions-editor-paste-and-slash.spec.ts](../tests/instructions-editor-paste-and-slash.spec.ts) - Editor paste/slash tests
- [tests/webchat-plugin.spec.ts](../tests/webchat-plugin.spec.ts) - Webchat plugin tests
- [tests/zendesk-plugin.spec.ts](../tests/zendesk-plugin.spec.ts) - Zendesk plugin tutorial tests

### Test Helpers

- [tests/helpers/auth.ts](../tests/helpers/auth.ts) - Authentication utilities
  - `getTestUserEmail()` - Generate test user email
  - `getTestOrgName()` - Generate test org name
  - `cleanupTestUsers()` - Delete old test users
  - `createTestUser()` - Create test user + org + tokens
  - `generateAuthState()` - Create Playwright storage state

### Global Setup

- [tests/global-setup.ts](../tests/global-setup.ts) - Runs before all tests
  - Initializes database connection
  - Cleans up old test users (pattern: `hay-e2e-%@test.com`)
  - Creates fresh test user + organization
  - Generates JWT tokens
  - Saves storage state to `playwright/.auth/user.json`

## Test Data Management

### Test User Pattern

Test users follow the pattern: `hay-e2e-YYYYMMDD@test.com`

**Automatic cleanup:**
- All users matching `hay-e2e-%@test.com` are deleted before each test run
- Associated organizations are also deleted
- Ensures clean state for each test run

### Manual Cleanup

If needed, you can manually cleanup test users:

```typescript
import { cleanupTestUsers } from "./tests/helpers/auth";
import { AppDataSource } from "./server/database/data-source";

await AppDataSource.initialize();
await cleanupTestUsers();
await AppDataSource.destroy();
```

## Configuration

### Playwright Config

[playwright.config.ts](../playwright.config.ts) configuration:

```typescript
{
  globalSetup: "./tests/global-setup.js",  // Runs once before all tests
  baseURL: "http://localhost:3000",        // Default URL for page.goto()
  storageState: "playwright/.auth/user.json",  // Auth state file
  webServer: [
    // Auto-starts server and dashboard if not running
    { command: "cd server && npm run dev", url: "http://localhost:3001" },
    { command: "cd dashboard && PORT=3000 npm run dev", url: "http://localhost:3000" }
  ]
}
```

### TypeScript Config

[tests/tsconfig.json](../tests/tsconfig.json) extends root config with:
- CommonJS modules for Playwright compatibility
- Playwright type definitions
- Path aliases for server/dashboard imports

## Debugging

### View Test Execution

```bash
# Interactive UI mode
npx playwright test --ui

# Headed mode (see browser)
npx playwright test --headed

# Debug mode (step through)
npx playwright test --debug
```

### View Test Reports

```bash
# Run tests
npx playwright test

# Open HTML report
npx playwright show-report
```

### View Traces

Traces are automatically captured on first retry:

```bash
npx playwright show-trace trace.zip
```

### Console Logs

Tests log browser console output:

```typescript
page.on("console", (msg) => console.log("Browser:", msg.text()));
```

### Screenshots

Capture screenshots for debugging:

```typescript
await page.screenshot({ path: "debug.png", fullPage: true });
```

## Performance Benefits

### Before (Manual Login)
```typescript
await page.goto("/login");
await page.fill('input[type="email"]', "test@test.com");
await page.fill('input[type="password"]', "password");
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);  // ~2-3 seconds
await page.goto("/plugins");
```

### After (Storage State)
```typescript
await page.goto("/plugins");  // Direct navigation, ~0 seconds for auth
```

**Performance gain**: ~2-3 seconds saved per test

## Troubleshooting

### "Storage state not found"

**Problem**: `playwright/.auth/user.json` doesn't exist

**Solution**: Run global setup manually
```bash
npx playwright test --grep @setup
```

### "Authentication failed"

**Problem**: Token expired or invalid

**Solution**: Re-run tests (global setup creates fresh tokens)
```bash
npx playwright test
```

### "Database connection failed"

**Problem**: PostgreSQL not running or `.env` misconfigured

**Solution**:
1. Start PostgreSQL: `brew services start postgresql@14`
2. Check `.env` has correct database credentials
3. Verify database exists: `psql -l`

### "Browser not found"

**Problem**: Playwright browsers not installed

**Solution**:
```bash
npx playwright install
```

### Tests fail after auth changes

**Problem**: Storage state structure outdated

**Solution**:
1. Update `generateAuthState()` in [tests/helpers/auth.ts](../tests/helpers/auth.ts)
2. Match new Pinia store structure
3. Re-run global setup

### URL token auth not working

**Problem**: Middleware not recognizing token

**Checklist**:
- Running in development (`NODE_ENV !== 'production'`)
- Token is valid (check expiry)
- Token passed correctly in URL: `?auth_token=xxx`
- Check browser console for auth middleware logs

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: pgvector/pgvector:pg14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npx playwright test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/hay_test

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

## Security Considerations

### Production Safety

- URL token auth **disabled** in production (`NODE_ENV !== 'production'`)
- Tokens expire after 15 minutes (JWT config)
- Storage state files in `.gitignore` (prevents committing tokens)
- Test users have distinctive pattern for easy identification

### Test User Isolation

- Test users are owners of their own organizations
- Each test run gets a fresh user/org (clean state)
- Old test data automatically cleaned up
- No impact on production data

## Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Tests](https://playwright.dev/docs/debug)
- [Test Reporters](https://playwright.dev/docs/test-reporters)

## Support

For issues or questions:
1. Check this documentation
2. Review [playwright.config.ts](../playwright.config.ts)
3. Check test examples in `/tests` directory
4. Open an issue on GitHub
