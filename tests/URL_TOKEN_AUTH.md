# URL Token Authentication

For automated testing and development purposes, the dashboard supports authentication via URL parameters.

**⚠️ Important: This feature is only available in non-production environments (`NODE_ENV !== "production"`).**

## Usage

Pass all three authentication tokens as URL parameters:

```
http://localhost:3000/?accessToken=<token>&refreshToken=<token>&expiresIn=<seconds>
http://localhost:3000/conversations?accessToken=<token>&refreshToken=<token>&expiresIn=3600
```

This method:
- Sets up complete authentication state (access token, refresh token, and expiration)
- Enables automatic token refresh
- Mimics the regular login flow exactly

## Automated Testing

The `tests/helpers/login.ts` helper uses this feature:

```typescript
import { navigateWithAuth } from "./tests/helpers/login";

// In your Playwright test
await navigateWithAuth(page, "/conversations");
```

This helper:
1. Calls the login API to get fresh tokens
2. Constructs the URL with all three token parameters
3. Navigates to the page with automatic authentication
4. Waits for the page to be ready

## How It Works

1. **Middleware Detection**: The auth middleware ([dashboard/middleware/auth.global.ts](dashboard/middleware/auth.global.ts:92)) detects token parameters in the URL
2. **Token Validation**: Calls `loginWithTokens()` in the auth store to validate and set up authentication
3. **User Data Fetch**: Fetches user data via the `/auth/me` endpoint
4. **State Setup**: Sets up complete authentication state (user, organization, permissions)
5. **URL Cleanup**: Removes tokens from the URL and redirects to clean path
6. **Security**: Tokens are immediately removed from the URL after processing

## Implementation Details

### Auth Store Method

The `loginWithTokens()` method in [dashboard/stores/auth.ts](dashboard/stores/auth.ts:179):

```typescript
await authStore.loginWithTokens({
  accessToken: "eyJhbGc...",
  refreshToken: "eyJhbGc...",
  expiresIn: 3600, // seconds
});
```

This method:
- Stores tokens in the auth store
- Validates tokens by fetching user data
- Sets `isAuthenticated` and `isInitialized` flags
- Updates activity timestamp
- Throws error if validation fails

### Middleware Integration

The middleware ([dashboard/middleware/auth.global.ts](dashboard/middleware/auth.global.ts:92)):
- Detects all three URL parameters (`accessToken`, `refreshToken`, `expiresIn`)
- Uses `loginWithTokens()` for complete auth setup
- Only works in development (`NODE_ENV !== "production"`)
- Cleans the URL after authentication
- Shows error toast if validation fails
- Redirects to clean path after successful login

## Security Notes

- **Development Only**: This feature is disabled in production
- **URL Cleanup**: Tokens are removed from URL immediately after use
- **No Storage in History**: URL replacement prevents tokens from appearing in browser history
- **Token Validation**: All tokens are validated against the API before use
- **Error Handling**: Invalid tokens trigger error messages and redirect to login

## Example Test

```typescript
import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

test("authenticated user can view conversations", async ({ page }) => {
  // Automatically logs in and navigates to /conversations
  await navigateWithAuth(page, "/conversations");

  // Now authenticated and on the conversations page
  await expect(page.locator("h1")).toContainText("Conversations");
});
```
