/**
 * Hay Plugin SDK v2 - Runner
 *
 * Worker process entry point for running plugin instances.
 *
 * This module orchestrates the entire plugin lifecycle:
 * - Loading and validating plugins
 * - Executing lifecycle hooks
 * - Starting HTTP server
 * - Managing org runtime
 * - Graceful shutdown
 *
 * @module @hay/plugin-sdk-v2/runner
 */

import { parseArgs, loadManifest } from './bootstrap';
import { loadPlugin } from './plugin-loader';
import { createGlobalContext } from './global-context';
import { executeOnInitialize, executeOnStart, executeOnDisable } from './hook-executor';
import { PluginHttpServer } from './http-server';
import {
  loadOrgDataFromEnv,
  createMockOrgData,
  createStartContext,
  createDisableContext,
  type OrgRuntimeData,
} from './org-context';
import { PluginRegistry } from '../sdk/registry';
import { createLogger } from '../sdk/logger';
import type { HayPluginDefinition } from '../types';

/**
 * Runner state.
 *
 * Tracks the current state of the runner for cleanup.
 */
interface RunnerState {
  httpServer: PluginHttpServer | null;
  plugin: HayPluginDefinition | null;
  orgData: OrgRuntimeData | null;
  isShuttingDown: boolean;
}

/**
 * Main runner entry point.
 *
 * Orchestrates the plugin worker lifecycle:
 * 1. Parse CLI args
 * 2. Load and validate manifest
 * 3. Load plugin code
 * 4. Create global context and execute onInitialize
 * 5. Start HTTP server
 * 6. Load org runtime data and execute onStart
 * 7. Handle graceful shutdown
 *
 * @remarks
 * Exit codes:
 * - 0: Success
 * - 1: Initialization failure (args, manifest, plugin load, onInitialize)
 * - 2: Runtime failure (HTTP server, onStart)
 */
async function main(): Promise<void> {
  const state: RunnerState = {
    httpServer: null,
    plugin: null,
    orgData: null,
    isShuttingDown: false,
  };

  // ============================================================================
  // Phase 1: Bootstrap (CLI args, manifest)
  // ============================================================================

  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error('❌ Failed to parse arguments:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const { pluginPath, orgId, port, mode } = args;

  // Create logger (org context added later)
  const logger = createLogger({ orgId });
  logger.info('Starting plugin worker', { pluginPath, orgId, port, mode });

  let manifest;
  try {
    const validated = loadManifest(pluginPath);
    manifest = validated.manifest;
    logger.info('Loaded plugin manifest', { displayName: manifest.displayName });

    // Load plugin code
    state.plugin = await loadPlugin(validated.entryPath, manifest.displayName);
    logger.info('Loaded plugin code', { name: state.plugin.name });
  } catch (err) {
    logger.error('Failed to load plugin', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  // ============================================================================
  // Phase 2: Global Initialization (onInitialize)
  // ============================================================================

  const registry = new PluginRegistry();

  try {
    const globalCtx = createGlobalContext(logger, registry, manifest);

    await executeOnInitialize(state.plugin, globalCtx, logger);
    logger.info('Plugin initialized successfully');
  } catch (err) {
    logger.error('Plugin initialization failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  // ============================================================================
  // Phase 3: HTTP Server Setup
  // ============================================================================

  try {
    state.httpServer = new PluginHttpServer(port, registry, logger);
    await state.httpServer.start();
    logger.info('HTTP server started successfully');
  } catch (err) {
    logger.error('Failed to start HTTP server', { error: err instanceof Error ? err.message : String(err) });
    process.exit(2);
  }

  // ============================================================================
  // Phase 4: Org Runtime Initialization (onStart)
  // ============================================================================

  try {
    // Load org data based on mode
    if (mode === 'production') {
      logger.info('Loading org runtime data from environment');
      state.orgData = loadOrgDataFromEnv();
    } else {
      logger.info('Using mock org runtime data (test mode)');
      state.orgData = createMockOrgData(orgId);
    }

    logger.info('Org runtime data loaded', { orgId: state.orgData.org.id });

    // Create start context and execute onStart
    const startCtx = createStartContext(state.orgData, registry, manifest, logger);
    const startSuccess = await executeOnStart(state.plugin, startCtx, logger);

    if (!startSuccess) {
      logger.warn('onStart hook failed - plugin is running but may be degraded');
      // Continue running (don't exit) - plugin is installed but degraded
    } else {
      logger.info('Plugin started successfully for organization');
    }
  } catch (err) {
    logger.error('Failed to initialize org runtime', { error: err instanceof Error ? err.message : String(err) });
    logger.warn('Plugin is running but org runtime failed to initialize');
    // Continue running - HTTP server is still available
  }

  // ============================================================================
  // Phase 5: Graceful Shutdown
  // ============================================================================

  const shutdown = async (signal: string): Promise<void> => {
    if (state.isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal', { signal });
      return;
    }

    state.isShuttingDown = true;
    logger.info('Received shutdown signal, starting graceful shutdown', { signal });

    try {
      // 1. Execute onDisable hook
      if (state.plugin && state.orgData) {
        const disableCtx = createDisableContext(state.orgData, logger);
        await executeOnDisable(state.plugin, disableCtx, logger);
      }

      // 2. Stop HTTP server
      if (state.httpServer) {
        await state.httpServer.stop();
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Keep process running
  logger.info('Plugin worker is ready and running');
}

// ============================================================================
// Run the main function
// ============================================================================

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Fatal error in runner:', err);
    process.exit(1);
  });
}

export { main };
