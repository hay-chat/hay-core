# URL Token Authentication Fix

## Problem
URL token authentication for E2E tests was failing because the `auth.me` endpoint required an organization ID header, but during URL token authentication flow, the user store was empty and couldn't provide an organization ID.

## Root Cause
1. The `protectedProcedure` middleware in `server/trpc/middleware/auth.ts` enforced organization ID requirement at lines 40-45
2. During URL token auth, `loginWithTokens()` calls `HayAuthApi.auth.me.query()`
3. The tRPC client tries to add `x-organization-id` header via `getOrganizationId()`
4. `getOrganizationId()` returns empty string because user store is not populated yet
5. Backend middleware throws "Organization ID is required" error

## Solution

### Backend Changes

#### 1. Created new middleware: `isAuthedWithoutOrg`
**File**: `server/trpc/middleware/auth.ts`

Added a new middleware that authenticates users without requiring organization ID:

```typescript
/**
 * Middleware to ensure user is authenticated without requiring organization ID
 * Used for endpoints that need to work before organization context is established
 */
export const isAuthedWithoutOrg = t.middleware<{ ctx: Context }>(({ ctx, next }) => {
  // Check authentication error
  const reqWithAuth = ctx.req as RequestWithAuthError;
  if (reqWithAuth.authError) {
    const errorMessage = reqWithAuth.authError;
    if (errorMessage.includes("Token has expired") || errorMessage.includes("token expired")) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Token has expired",
        cause: { type: "TOKEN_EXPIRED" },
      });
    }
  }

  // Only check user authentication, NOT organization ID
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user as AuthUser,
    },
  });
});

/**
 * Protected procedure without organization requirement
 */
export const protectedProcedureWithoutOrg = t.procedure.use(isAuthedWithoutOrg);
```

#### 2. Updated `auth.me` endpoint
**File**: `server/routes/v1/auth/index.ts`

Changed the `me` endpoint to use the new middleware:

```typescript
// Before:
me: protectedProcedure
  .output(...)
  .query(async ({ ctx }) => { ... })

// After:
me: protectedProcedureWithoutOrg
  .output(...)
  .query(async ({ ctx }) => { ... })
```

The endpoint implementation already handled missing organization ID gracefully:
- Line 589: Falls back if `ctx.organizationId` is not available
- Uses most recently accessed org or legacy org ID as fallback

### Frontend Changes

#### 1. Fixed missing userStore import
**File**: `dashboard/stores/auth.ts`

Added missing `useUserStore()` initialization in `loginWithTokens` method:

```typescript
async loginWithTokens(data: { accessToken: string; refreshToken: string; expiresIn: number }) {
  this.isLoading = true;
  try {
    // Set tokens first
    this.tokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };

    // Fetch user data
    const user = await HayAuthApi.auth.me.query();

    // Initialize user store and set user data
    const userStore = useUserStore();  // <-- Added this line
    userStore.setUser(user as User);

    this.isAuthenticated = true;
    this.isInitialized = true;
    this.updateActivity();
  } catch (error) {
    // ...error handling
  } finally {
    this.isLoading = false;
  }
}
```

#### 2. Improved URL cleanup
**File**: `dashboard/middleware/auth.global.ts`

Changed from `nextTick()` with `window.history.replaceState` to using `navigateTo()` with `replace: true`:

```typescript
// Clean URL by removing tokens and navigating with replace
const cleanQuery = { ...to.query };
delete cleanQuery.accessToken;
delete cleanQuery.refreshToken;
delete cleanQuery.expiresIn;

// Navigate to the same path with clean query params
return navigateTo({ path: to.path, query: cleanQuery }, { replace: true });
```

This ensures tokens are removed from the URL immediately after authentication.

### Test Updates

#### Updated test expectations
**File**: `tests/url-token-auth.spec.ts`

Changed to expect redirect to `/getting-started` (onboarding flow for new users):

```typescript
// Before:
await expect(page).toHaveURL(/^\/$/, { timeout: 10000 });

// After:
await expect(page).toHaveURL(/\/(getting-started|dashboard)/, { timeout: 10000 });
```

## Test Results

All 3 E2E tests now pass:

```
✓ should authenticate user with URL tokens and redirect to dashboard
✓ should authenticate and navigate to specific path
✓ should handle invalid tokens gracefully
```

## Key Insights

1. **Chicken-and-egg problem**: URL token auth needed to call `auth.me` to get organization data, but `auth.me` required organization ID in the header
2. **Solution pattern**: Create middleware variant without strict requirements for bootstrap endpoints
3. **Backend flexibility**: The `auth.me` endpoint implementation was already flexible enough to handle missing org ID - only the middleware needed updating
4. **URL cleanup**: Using `navigateTo()` with `replace: true` is more reliable than `nextTick()` + `window.history.replaceState`

## Files Modified

### Backend
- `server/trpc/middleware/auth.ts` - Added `isAuthedWithoutOrg` middleware and `protectedProcedureWithoutOrg` procedure
- `server/routes/v1/auth/index.ts` - Changed `me` endpoint to use `protectedProcedureWithoutOrg`

### Frontend
- `dashboard/stores/auth.ts` - Fixed missing `useUserStore()` import in `loginWithTokens`
- `dashboard/middleware/auth.global.ts` - Improved URL cleanup using `navigateTo()`

### Tests
- `tests/url-token-auth.spec.ts` - Updated expectations to account for onboarding redirect

## Security Notes

- URL token authentication is **only enabled in development mode** (`NODE_ENV !== "production"`)
- Console warnings are logged when URL token auth is used
- Tokens are removed from URL immediately after authentication
- This feature is designed for E2E testing, not production use
