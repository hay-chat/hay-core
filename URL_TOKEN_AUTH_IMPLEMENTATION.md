# URL Token Authentication Implementation

## Summary

Implemented a clean URL-based token authentication system for automated testing and development. Users can now authenticate by passing `accessToken`, `refreshToken`, and `expiresIn` as URL parameters, which mimics the standard login flow.

## Changes Made

### 1. Auth Store Enhancement
**File**: [dashboard/stores/auth.ts](dashboard/stores/auth.ts#L179)

Added `loginWithTokens()` method:
```typescript
async loginWithTokens(data: { accessToken: string; refreshToken: string; expiresIn: number })
```

**Features**:
- Sets complete authentication state (tokens, user data, organization)
- Validates tokens by fetching user data via `/auth/me` endpoint
- Handles errors by clearing invalid auth state
- Mimics the regular `login()` flow exactly

### 2. Middleware Update
**File**: [dashboard/middleware/auth.global.ts](dashboard/middleware/auth.global.ts#L92)

Enhanced auth middleware to detect and process URL tokens:
- Checks for `accessToken`, `refreshToken`, and `expiresIn` in URL params
- Only works in development (`NODE_ENV !== "production"`)
- Calls `loginWithTokens()` to set up complete auth
- Removes tokens from URL after authentication (security)
- Shows error toast if validation fails
- Redirects to clean URL path

### 3. Test Helper Update
**File**: [tests/helpers/login.ts](tests/helpers/login.ts#L48)

Updated `navigateWithAuth()` to use full token set:
```typescript
const { accessToken, refreshToken, expiresIn } = result;
const params = new URLSearchParams({ accessToken, refreshToken, expiresIn: expiresIn.toString() });
await page.goto(`${path}?${params.toString()}`);
```

### 4. Documentation
**Files**:
- [tests/URL_TOKEN_AUTH.md](tests/URL_TOKEN_AUTH.md) - Complete usage guide
- [tests/url-token-auth.spec.ts](tests/url-token-auth.spec.ts) - E2E test examples

## Usage

### In Tests
```typescript
import { navigateWithAuth } from "./helpers/login";

test("user can view dashboard", async ({ page }) => {
  await navigateWithAuth(page, "/dashboard");
  // User is now authenticated
});
```

### Manual Testing
```bash
# Get tokens from login API
curl -X POST http://localhost:3001/v1/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Use tokens in URL
http://localhost:3000/?accessToken=xxx&refreshToken=xxx&expiresIn=3600
```

## Security Features

✅ **Development Only**: Disabled in production environments
✅ **URL Cleanup**: Tokens removed from URL immediately after use
✅ **No Browser History**: Uses `replace: true` to prevent tokens in history
✅ **Token Validation**: All tokens validated via API before accepting
✅ **Error Handling**: Invalid tokens trigger error messages and login redirect

## Flow Diagram

```
1. User navigates to URL with tokens
   ↓
2. Middleware detects token params (development only)
   ↓
3. Calls authStore.loginWithTokens()
   ↓
4. Validates tokens via /auth/me API
   ↓
5. Sets up auth state (tokens, user, organization)
   ↓
6. Removes tokens from URL
   ↓
7. Redirects to clean path
   ↓
8. User is authenticated!
```

## Testing

Run the URL token auth tests:
```bash
npx playwright test tests/url-token-auth.spec.ts
```

## Benefits

1. **E2E Testing**: Simplifies Playwright test authentication
2. **Development**: Quick login without forms
3. **Complete Auth**: Full token set enables refresh capability
4. **Clean Code**: No legacy backward compatibility cruft
5. **Secure**: Development-only with automatic URL cleanup

## Files Modified

- `dashboard/stores/auth.ts` - Added `loginWithTokens()` method
- `dashboard/middleware/auth.global.ts` - URL token detection and processing
- `tests/helpers/login.ts` - Updated to use full token set

## Files Created

- `tests/URL_TOKEN_AUTH.md` - Usage documentation
- `tests/url-token-auth.spec.ts` - E2E tests
- `URL_TOKEN_AUTH_IMPLEMENTATION.md` - This file
