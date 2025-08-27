# Authentication System

This document describes the improved authentication system for the Hay Dashboard.

## Overview

The authentication system has been redesigned to be more robust, persistent, and consistent. It addresses the previous issues with session management and hard refresh problems.

## Key Improvements

### 1. **Persistent Session Management**

- Tokens are now properly persisted using Pinia's persistence plugin
- Session state survives hard refreshes and browser restarts
- Automatic token refresh before expiration
- Session timeout management with user activity tracking

### 2. **Centralized State Management**

- Single source of truth using Pinia stores
- Simplified composables that act as wrappers around stores
- Global auth provider component for consistent state access

### 3. **Robust Initialization**

- Proper initialization sequence that prevents race conditions
- Better error handling and fallback mechanisms
- Prevention of multiple initialization attempts

### 4. **Improved Token Management**

- Automatic token refresh 5 minutes before expiration
- Better validation of stored tokens
- Proper cleanup of expired sessions

## Architecture

### Stores

#### `useAuthStore` (`stores/auth.ts`)

- Manages authentication state (user, tokens, loading, errors)
- Handles login, logout, token refresh, and session validation
- Implements session timeout and activity tracking
- Persists critical data to localStorage

#### `useUserStore` (`stores/user.ts`)

- Manages user profile and preferences
- Handles organization and team member data
- Persists user preferences

### Composables

#### `useAuth()` (`composables/useAuth.ts`)

- Simplified wrapper around auth store
- Provides clean API for authentication operations
- Maintains backward compatibility

#### `useGlobalAuth()` (`composables/useGlobalAuth.ts`)

- Global auth state management
- Centralized initialization and error handling
- Provides reactive auth state

### Components

#### `AuthProvider` (`components/auth/AuthProvider.vue`)

- Wraps the entire application
- Ensures proper auth initialization
- Provides auth context to child components

### Middleware

#### `auth` (`middleware/auth.ts`)

- Protects routes requiring authentication
- Handles initialization state properly
- Manages session timeout redirects

## Usage

### Basic Authentication

```vue
<script setup>
import { useAuth } from '~/composables/useAuth';

const { user, isAuthenticated, login, logout } = useAuth();

const handleLogin = async () => {
  try {
    await login({
      email: 'user@example.com',
      password: 'password',
    });
    // Redirect or show success message
  } catch (error) {
    // Handle error
  }
};
</script>
```

### Global Auth State

```vue
<script setup>
import { useGlobalAuth } from '~/composables/useGlobalAuth';

const { isAuthenticated, user, initialize } = useGlobalAuth();

// Initialize auth if needed
onMounted(async () => {
  await initialize();
});
</script>
```

### Protected Routes

```vue
<script setup>
definePageMeta({
  middleware: 'auth',
});
</script>
```

### Direct Store Access

```vue
<script setup>
import { useAuthStore } from '~/stores/auth';

const authStore = useAuthStore();

// Access store directly when needed
console.log(authStore.isAuthenticated);
</script>
```

## Configuration

### Session Timeout

- Default: 60 minutes of inactivity
- Configurable in `stores/auth.ts`

### Token Refresh

- Default: 5 minutes before expiration
- Configurable in `stores/auth.ts`

### Persistence

- Tokens and user data persisted to localStorage
- 7-day maximum session age
- Automatic cleanup of invalid data

## Error Handling

The system includes comprehensive error handling:

1. **Network Errors**: Graceful fallback and retry mechanisms
2. **Token Expiration**: Automatic refresh or logout
3. **Invalid Sessions**: Clear state and redirect to login
4. **Initialization Failures**: Proper cleanup and error logging

## Security Features

1. **Token Validation**: Server-side validation on each request
2. **Session Timeout**: Automatic logout after inactivity
3. **Secure Storage**: Tokens stored in localStorage with validation
4. **Activity Tracking**: User activity monitoring for session management

## Migration from Old System

The new system maintains backward compatibility with the existing `useAuth()` composable. Existing code should continue to work without changes.

### Breaking Changes

- None - the API remains the same
- Improved error handling and state management
- Better persistence and session management

## Troubleshooting

### Session Lost on Refresh

- Check if tokens are properly persisted
- Verify localStorage is available
- Check for initialization errors in console

### Token Refresh Issues

- Verify refresh token is valid
- Check network connectivity
- Review server-side token validation

### Authentication State Inconsistencies

- Clear localStorage and re-login
- Check for multiple initialization calls
- Verify middleware configuration

## Development

### Testing Authentication

1. Login with valid credentials
2. Hard refresh the page
3. Verify session persists
4. Test token refresh by waiting for expiration
5. Test session timeout with inactivity

### Debugging

- Check browser console for auth-related logs
- Monitor localStorage for token persistence
- Use Vue DevTools to inspect Pinia stores
- Check network tab for API calls

## Future Improvements

1. **Refresh Token Rotation**: Implement refresh token rotation for better security
2. **Multi-tab Support**: Synchronize auth state across browser tabs
3. **Offline Support**: Cache user data for offline access
4. **Biometric Authentication**: Add biometric login support
5. **Audit Logging**: Track authentication events for security monitoring





