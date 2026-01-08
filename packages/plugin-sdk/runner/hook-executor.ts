/**
 * Hay Plugin SDK - Hook Executor
 *
 * Executes plugin lifecycle hooks with proper error handling.
 *
 * @module @hay/plugin-sdk/runner/hook-executor
 */

import type {
  HayPluginDefinition,
  HayGlobalContext,
  HayStartContext,
  HayAuthValidationContext,
  HayConfigUpdateContext,
  HayDisableContext,
} from '../types/index.js';
import type { HayLogger } from '../types/index.js';

/**
 * Execute the onInitialize hook.
 *
 * @param plugin - Plugin definition
 * @param globalCtx - Global context
 * @param logger - Logger instance
 * @throws Error if hook fails
 *
 * @remarks
 * This is the **global initialization hook** called once per worker process.
 * It must complete successfully or the worker should exit.
 *
 * @see PLUGIN.md Section 4.1 (lines 168-193)
 */
export async function executeOnInitialize(
  plugin: HayPluginDefinition,
  globalCtx: HayGlobalContext,
  logger: HayLogger
): Promise<void> {
  if (!plugin.onInitialize) {
    logger.debug('Plugin has no onInitialize hook, skipping');
    return;
  }

  logger.info('Executing onInitialize hook');

  try {
    const result = plugin.onInitialize(globalCtx);

    // Handle both sync and async hooks
    if (result && typeof result === 'object' && 'then' in result) {
      await result;
    }

    logger.info('onInitialize hook completed successfully');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('onInitialize hook failed', { error: errorMsg });
    throw new Error(`onInitialize hook failed: ${errorMsg}`);
  }
}

/**
 * Execute the onStart hook.
 *
 * @param plugin - Plugin definition
 * @param startCtx - Start context
 * @param logger - Logger instance
 * @returns True if hook succeeded, false if it failed
 *
 * @remarks
 * This is the **org runtime start hook** called when the plugin starts for an org.
 * If this fails, the plugin stays installed but may be marked as "degraded".
 * We don't throw here - we log the error and return false.
 *
 * @see PLUGIN.md Section 4.2 (lines 195-223)
 */
export async function executeOnStart(
  plugin: HayPluginDefinition,
  startCtx: HayStartContext,
  logger: HayLogger
): Promise<boolean> {
  if (!plugin.onStart) {
    logger.debug('Plugin has no onStart hook, skipping');
    return true;
  }

  logger.info('Executing onStart hook', { orgId: startCtx.org.id });

  try {
    const result = plugin.onStart(startCtx);

    // Handle both sync and async hooks
    if (result && typeof result === 'object' && 'then' in result) {
      await result;
    }

    logger.info('onStart hook completed successfully');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('onStart hook failed', { error: errorMsg });
    // Don't throw - just return false to indicate failure
    return false;
  }
}

/**
 * Execute the onValidateAuth hook.
 *
 * @param plugin - Plugin definition
 * @param authCtx - Auth validation context
 * @param logger - Logger instance
 * @returns True if auth is valid, false otherwise
 *
 * @remarks
 * If the hook is not defined, returns true (assume valid).
 * If the hook throws, returns false (auth failed).
 *
 * @see PLUGIN.md Section 4.3 (lines 225-258)
 */
export async function executeOnValidateAuth(
  plugin: HayPluginDefinition,
  authCtx: HayAuthValidationContext,
  logger: HayLogger
): Promise<boolean> {
  if (!plugin.onValidateAuth) {
    logger.debug('Plugin has no onValidateAuth hook, assuming auth is valid');
    return true;
  }

  logger.info('Executing onValidateAuth hook', { orgId: authCtx.org.id });

  try {
    const result = plugin.onValidateAuth(authCtx);

    // Handle both sync and async hooks
    const isValid =
      result && typeof result === 'object' && 'then' in result
        ? await result
        : result;

    logger.info('onValidateAuth hook completed', { isValid });
    return Boolean(isValid);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn('onValidateAuth hook threw error, treating as invalid', {
      error: errorMsg,
    });
    return false;
  }
}

/**
 * Execute the onConfigUpdate hook.
 *
 * @param plugin - Plugin definition
 * @param configCtx - Config update context
 * @param logger - Logger instance
 *
 * @remarks
 * This hook is optional. Most plugins can omit it and handle updates in onStart.
 * If it fails, we log the error but don't crash.
 *
 * @see PLUGIN.md Section 4.4 (lines 260-273)
 */
export async function executeOnConfigUpdate(
  plugin: HayPluginDefinition,
  configCtx: HayConfigUpdateContext,
  logger: HayLogger
): Promise<void> {
  if (!plugin.onConfigUpdate) {
    logger.debug('Plugin has no onConfigUpdate hook, skipping');
    return;
  }

  logger.info('Executing onConfigUpdate hook', { orgId: configCtx.org.id });

  try {
    const result = plugin.onConfigUpdate(configCtx);

    // Handle both sync and async hooks
    if (result && typeof result === 'object' && 'then' in result) {
      await result;
    }

    logger.info('onConfigUpdate hook completed successfully');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('onConfigUpdate hook failed', { error: errorMsg });
    // Don't throw - just log the error
  }
}

/**
 * Execute the onDisable hook.
 *
 * @param plugin - Plugin definition
 * @param disableCtx - Disable context
 * @param logger - Logger instance
 *
 * @remarks
 * This hook is called when the plugin is uninstalled/disabled.
 * If it fails, we log the error but proceed with cleanup.
 *
 * @see PLUGIN.md Section 4.5 (lines 276-295)
 */
export async function executeOnDisable(
  plugin: HayPluginDefinition,
  disableCtx: HayDisableContext,
  logger: HayLogger
): Promise<void> {
  if (!plugin.onDisable) {
    logger.debug('Plugin has no onDisable hook, skipping');
    return;
  }

  logger.info('Executing onDisable hook', { orgId: disableCtx.org.id });

  try {
    const result = plugin.onDisable(disableCtx);

    // Handle both sync and async hooks
    if (result && typeof result === 'object' && 'then' in result) {
      await result;
    }

    logger.info('onDisable hook completed successfully');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('onDisable hook failed', { error: errorMsg });
    // Don't throw - just log the error
  }
}
