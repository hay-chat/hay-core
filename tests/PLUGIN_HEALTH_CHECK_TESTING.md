# Plugin Health Check and Settings E2E Testing

## Overview

Comprehensive E2E test that verifies plugins are loading health checks and custom settings correctly in the UI, with automatic authentication and API call tracking.

## Test File

**Location:** [tests/plugin-health-check-and-settings.spec.ts](plugin-health-check-and-settings.spec.ts)

## What's Tested

### ✅ Shopify Plugin (Connector-Type MCP Plugin)

Tests a connector-type plugin which should have explicit health check UI:

1. **Installation** - Installs Shopify plugin (MCP Connector)
2. **Settings Check** - Verifies configuration UI
3. **Health Check UI** - Verifies Connection Test section exists
4. **Test Button** - Checks for "Test Connection" button

#### What's Verified:

| Check | Description | Expected Result |
|-------|-------------|-----------------|
| ✅ Settings Visible | Configuration section is displayed | **Must Pass** |
| ✅ Connection Test UI | "Connection Test" section or button present | **Expected for connectors** |

## Running the Tests

### Run All Tests (Recommended)

```bash
# Run with Chromium only (fastest and most reliable)
npx playwright test tests/plugin-health-check-and-settings.spec.ts --project=chromium
```

### Run Only Shopify Connector Test

```bash
npx playwright test tests/plugin-health-check-and-settings.spec.ts --grep "Shopify" --project=chromium
```

### Run with Visual Browser

```bash
# IMPORTANT: Use --project=chromium to avoid running in multiple browsers
npx playwright test tests/plugin-health-check-and-settings.spec.ts --headed --project=chromium
```

### Debug Mode

```bash
npx playwright test tests/plugin-health-check-and-settings.spec.ts --debug --project=chromium
```

### Why Use `--project=chromium`?

The tests are configured to run **sequentially** (not in parallel) to avoid conflicts when installing plugins. When you don't specify a project, Playwright tries to run the tests in all configured browsers (chromium, firefox, webkit) simultaneously, which can cause:
- Race conditions during plugin installation
- Database conflicts
- Test failures

**Always use `--project=chromium`** for reliable test execution.

## API Call Tracking

The test automatically intercepts and logs all network requests to track:

- `plugins.get` - Fetch plugin details
- `plugins.getAll` - Fetch all plugins
- `plugins.getConfiguration` - Fetch plugin configuration
- `plugins.testConnection` - Health check API call
- `plugins.configure` - Save plugin configuration

## Screenshots

Each test run automatically captures a full-page screenshot:

**Location:** `test-results/plugin-health-check-and-settings.png`

This screenshot shows the final state of the plugin settings page and can be used for:
- Visual verification
- Debugging test failures
- Documentation

## Understanding the Results

### Connector-Type Plugins (Shopify, Stripe, etc.)

Connector-type plugins should:
- ✅ Show configuration/settings UI
- ✅ Have "Connection Test" section
- ✅ Have "Test Connection" button
- ✅ Show connection status badge
- ✅ Call health check API when configured

## Troubleshooting

### Settings Not Showing

If settings don't appear:
1. Check that the plugin has `configSchema` in its manifest
2. Verify the plugin is enabled (not just installed)
3. Check browser console for errors
4. Review screenshot in `test-results/`

### Health Check Not Called

This is normal for tool-type plugins. If it's a connector plugin:
1. Check if plugin configuration is valid
2. Verify the plugin implements `testConnection` capability
3. Check if the plugin requires configuration before testing
4. Look for "Test Connection" button and click it manually

### API Calls Not Being Tracked

- Make sure you're using the correct test file
- Check that network interception is working (look for console logs)
- Verify the API endpoints match the expected patterns

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# GitHub Actions example
- name: Run Plugin Health Check Tests
  run: |
    npm run build
    npx playwright test tests/plugin-health-check-and-settings.spec.ts --reporter=html

- name: Upload Test Results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: plugin-test-results
    path: |
      test-results/
      playwright-report/
```

## Key Features

- ✅ **Zero manual setup** - Automatic authentication and test user creation
- ✅ **API call tracking** - Monitors all plugin-related API requests
- ✅ **Comprehensive verification** - Checks settings UI, health check UI, and API calls
- ✅ **Detailed logging** - Step-by-step console output for debugging
- ✅ **Automatic screenshots** - Visual evidence of test execution
- ✅ **Support for different plugin types** - Tool plugins vs Connector plugins
- ✅ **Robust selectors** - Works with different UI configurations (tabs, headings, form elements)

## Next Steps

To extend these tests:

1. **Add more connector plugins** - Test Stripe, Zendesk, etc.
2. **Test configuration save** - Verify settings can be saved and persisted
3. **Test health check result** - Verify success/failure states are displayed correctly
4. **Test plugin disable** - Verify plugins can be disabled after installation
5. **Add performance metrics** - Track page load times and API response times

## Related Files

- [tests/helpers/login.ts](helpers/login.ts) - Authentication helper
- [tests/helpers/auth.ts](helpers/auth.ts) - Test user creation and cleanup
- [tests/global-setup.ts](global-setup.ts) - Global test setup
