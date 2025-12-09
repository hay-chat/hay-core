import { HayPlugin } from './HayPlugin';

/**
 * Start plugin worker process
 *
 * This function is the entry point for all plugin workers.
 * It instantiates the plugin class, sets up graceful shutdown handlers,
 * and starts the HTTP server.
 *
 * Example usage in plugin's dist/index.js:
 * ```typescript
 * import { startPluginWorker } from '@hay/plugin-sdk';
 * import WhatsAppPlugin from './WhatsAppPlugin';
 *
 * startPluginWorker(WhatsAppPlugin);
 * ```
 *
 * @param PluginClass - The plugin class constructor (must extend HayPlugin)
 */
export async function startPluginWorker(
  PluginClass: new () => HayPlugin
): Promise<void> {
  let plugin: HayPlugin | null = null;

  try {
    // Instantiate plugin
    plugin = new PluginClass();

    console.log(`[PluginWorker] Starting plugin: ${plugin.metadata.id} v${plugin.metadata.version}`);

    // Setup graceful shutdown handlers
    const shutdown = async (signal: string) => {
      console.log(`[PluginWorker] Received ${signal}, shutting down gracefully...`);

      if (plugin) {
        try {
          // Call plugin's onDisable hook if available
          if (plugin.onDisable) {
            await plugin.onDisable();
          }

          // Stop HTTP server
          await plugin._stop();

          console.log(`[PluginWorker] Shutdown complete`);
          process.exit(0);
        } catch (error) {
          console.error(`[PluginWorker] Error during shutdown:`, error);
          process.exit(1);
        }
      } else {
        process.exit(0);
      }
    };

    // Handle SIGTERM (graceful shutdown from plugin manager)
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle SIGINT (Ctrl+C during development)
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error(`[PluginWorker] Uncaught exception:`, error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any) => {
      console.error(`[PluginWorker] Unhandled rejection:`, reason);
      process.exit(1);
    });

    // Start worker (calls plugin.onInitialize and starts HTTP server)
    await plugin._start();

    console.log(`[PluginWorker] Plugin ${plugin.metadata.id} started successfully`);

    // Call plugin's onEnable hook if available
    if (plugin.onEnable) {
      await plugin.onEnable();
    }

  } catch (error) {
    console.error(`[PluginWorker] Failed to start plugin:`, error);
    process.exit(1);
  }
}
