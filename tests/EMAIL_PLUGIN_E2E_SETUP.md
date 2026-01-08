# Email Plugin E2E Testing Setup

## Overview

This document describes the automated E2E testing setup for the email plugin installation workflow.

## Test Infrastructure

### Automated Test User Creation

The E2E test infrastructure automatically handles test user setup and authentication:

1. **Global Setup** ([tests/global-setup.ts](global-setup.ts))
   - Runs before all tests
   - Creates a fresh test user and organization each day
   - Generates JWT tokens for authentication
   - Stores authentication state for Playwright

2. **Test User Credentials**
   - Email: `hay-e2e-YYYYMMDD@test.com` (changes daily)
   - Password: `E2eTest@123456`
   - Organization: `E2E Test Org YYYYMMDD`
   - User role: `owner`

3. **Authentication Helper** ([tests/helpers/login.ts](helpers/login.ts))
   - `navigateWithAuth(page, path)` - Logs in via API and navigates to any page
   - Uses URL token authentication (for E2E testing)
   - No manual authentication required

### Database Cleanup

The cleanup function in [tests/helpers/auth.ts](helpers/auth.ts) now properly handles:
- Plugin instances (deletes first to avoid FK constraints)
- User accounts
- Organizations
- User-organization relationships

## Test Files

### 1. Email Plugin Installation Test

**File:** [tests/email-plugin-installation.spec.ts](email-plugin-installation.spec.ts)

**Tests:**
1. **Full Installation Flow** - Tests the complete workflow:
   - Navigate to `/integrations/marketplace`
   - Find Email plugin
   - Click Install button
   - Verify redirect to plugin settings page
   - Verify settings form is visible
   - Check for MCP health check UI (if available)

2. **Already Installed Plugin** - Tests accessing an already-installed plugin:
   - Navigate directly to `/integrations/plugins/%40hay%2Femail-plugin`
   - Verify plugin is enabled
   - Verify settings are visible
   - Check for health check/connection status UI

**Key Features:**
- Tests run sequentially (not in parallel) to avoid conflicts
- Automatic authentication via `navigateWithAuth()`
- Screenshots saved to `test-results/email-plugin-installed.png`
- Comprehensive logging for debugging

## Running the Tests

### Run All Email Plugin Tests

```bash
npx playwright test tests/email-plugin-installation.spec.ts
```

### Run Specific Test

```bash
# Run only the installation test
npx playwright test tests/email-plugin-installation.spec.ts --grep "should install email plugin"

# Run only the already-installed test
npx playwright test tests/email-plugin-installation.spec.ts --grep "should show settings"
```

### Run with UI

```bash
npx playwright test tests/email-plugin-installation.spec.ts --headed
```

### Debug Mode

```bash
npx playwright test tests/email-plugin-installation.spec.ts --debug
```

## Test Assertions

### ✅ What's Verified

1. **Marketplace**
   - Plugins load successfully
   - Email plugin is visible
   - Install button is clickable

2. **Installation**
   - Plugin installs without errors
   - Redirects to settings page
   - URL contains correct plugin ID (`%40hay%2Femail-plugin`)

3. **Settings Page**
   - Plugin page loads
   - Configuration section is visible
   - Form elements are present

4. **Health Check**
   - Checks for MCP connection status badges
   - Checks for Test Connection button
   - Notes when health check UI is not present (normal for tool-type plugins)

## Test Output Example

```
✨ [E2E Setup] Global setup completed successfully!
   Email: hay-e2e-20251220@test.com
   Password: E2eTest@123456
   Organization: E2E Test Org 20251220

Step 1: Navigating to marketplace...
✅ Authenticated and navigated to /integrations/marketplace

Step 2: Looking for Email plugin in marketplace...
Step 3: Checking if Email plugin is already installed...
Email plugin not installed. Installing now...

Step 5: Verifying plugin settings page loaded...
Step 6: Verifying settings form is visible...
✅ Settings form is visible

Step 8: Verifying MCP health check status...
⚠️  No explicit health check UI found (expected for tool-type plugins)

✅ EMAIL PLUGIN E2E TEST PASSED
✅ Plugin installed from marketplace
✅ Settings page loaded and visible
✅ Configuration fields are present

  ✓  2 tests passed (12.4s)
```

## Troubleshooting

### Test User Already Exists

If you see FK constraint errors during cleanup:
- The cleanup function now properly deletes plugin instances first
- This should no longer be an issue

### Authentication Failing

- Check that the server is running on `http://localhost:3001`
- Verify database is accessible
- Check that the `auth.login` tRPC endpoint is working

### Plugin Not Found in Marketplace

- Ensure the Email plugin is built (`npm run build` in the plugin directory)
- Check that the plugin manifest is valid
- Verify plugin is in the correct directory (`plugins/core/email`)

## Integration with CI/CD

These tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run E2E Tests
  run: |
    npm run build
    npm run test:e2e
```

## Future Improvements

- [ ] Add test for plugin configuration save
- [ ] Add test for MCP health check functionality
- [ ] Add test for plugin disable/uninstall
- [ ] Add visual regression testing
- [ ] Add performance metrics
