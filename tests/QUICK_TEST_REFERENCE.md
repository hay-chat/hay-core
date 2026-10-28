# Quick E2E Test Reference

## Plugin Tests

### Shopify Connector Health Check & Settings
```bash
npx playwright test tests/plugin-health-check-and-settings.spec.ts --project=chromium
```

### Run with Visual Browser
```bash
npx playwright test tests/plugin-health-check-and-settings.spec.ts --project=chromium --headed
```

## Common Issues

### "Executable doesn't exist" Error
**Problem:** Multiple browsers trying to run
**Solution:** Always add `--project=chromium`

### Test Timeout
**Problem:** Tests taking too long
**Solution:**
1. Check dashboard and server are running
2. Use `--headed` to see what's happening
3. Check test-results/ for screenshots

### Plugin Already Installed
**Normal:** Tests handle this automatically
**What happens:** If plugin exists, it clicks "Configure" instead of "Install"

## Test Output Files

- **Screenshots:** `test-results/plugin-health-check-and-settings.png`
- **HTML Report:** `playwright-report/index.html` (run `npx playwright show-report`)
- **Error Context:** `test-results/*/error-context.md` (on failures)

## Authentication

**No setup needed!** Tests automatically:
1. Create fresh test user (hay-e2e-YYYYMMDD@test.com)
2. Login via API
3. Navigate with authentication tokens
4. Clean up after tests

## Key Commands Quick Reference

| Command | Purpose |
|---------|---------|
| `--project=chromium` | Run in Chromium only (recommended) |
| `--headed` | Show browser window |
| `--debug` | Step through test in debug mode |
| `--grep "Shopify"` | Run only tests matching "Shopify" |
| `--reporter=list` | Compact output |

## Pre-requisites

1. ✅ Server running on `localhost:3001`
2. ✅ Dashboard running on `localhost:3000`
3. ✅ Database accessible
4. ✅ Plugins built (`scripts/build-plugins.sh`)

That's it! Just run the command and everything else is automatic. 🚀
