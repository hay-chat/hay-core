/**
 * Hay Plugin SDK - Runtime Auth API Implementation
 *
 * Implementation of the runtime auth API for accessing authentication state.
 *
 * @module @hay/plugin-sdk/sdk/auth-runtime
 */

import type { HayAuthRuntimeAPI, AuthState } from '../types/index.js';
import type { HayLogger } from '../types/index.js';

/**
 * Runtime auth API options.
 *
 * @internal
 */
export interface AuthRuntimeAPIOptions {
  /**
   * Organization-specific auth state.
   * Null if no auth is configured for this org.
   */
  authState: AuthState | null;

  /**
   * Logger for warnings.
   */
  logger: HayLogger;
}

/**
 * Create a Runtime Auth API instance.
 *
 * This API is used in org runtime hooks (onStart, onValidateAuth, etc.)
 * to access the resolved authentication state for the current organization.
 *
 * @param options - Runtime auth API options
 * @returns Runtime auth API implementation
 *
 * @remarks
 * **CONSTRAINT**: This API must NOT be used in onInitialize.
 * Use `RegisterAuthAPI` there instead to register auth methods.
 *
 * The returned auth state contains:
 * - `methodId`: The ID of the active auth method (e.g., "apiKey", "oauth")
 * - `credentials`: Method-specific credentials (e.g., `{ apiKey: "..." }`)
 *
 * Returns `null` if no auth is configured for the org.
 *
 * @internal
 */
export function createAuthRuntimeAPI(
  options: AuthRuntimeAPIOptions,
): HayAuthRuntimeAPI {
  const { authState, logger } = options;

  return {
    get(): AuthState | null {
      if (authState === null) {
        logger.debug('No auth state configured for this organization');
        return null;
      }

      // Validate auth state structure (defensive check)
      if (!authState.methodId || typeof authState.methodId !== 'string') {
        logger.warn('Invalid auth state: methodId is missing or not a string');
        return null;
      }

      if (!authState.credentials || typeof authState.credentials !== 'object') {
        logger.warn('Invalid auth state: credentials is missing or not an object');
        return null;
      }

      logger.debug('Retrieved auth state', { methodId: authState.methodId });

      // Return a copy to prevent mutations
      return {
        methodId: authState.methodId,
        credentials: { ...authState.credentials },
      };
    },
  };
}
