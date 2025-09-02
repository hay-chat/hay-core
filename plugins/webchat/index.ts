import { WebchatPlugin } from './src/WebchatPlugin';
import { manifest } from './manifest';

// Create and export plugin instance
const plugin = new WebchatPlugin(manifest);

// Export for use
export default plugin;

// Start the plugin if run directly
if (require.main === module) {
  // Listen for IPC messages from parent process
  process.on('message', async (message: any) => {
    try {
      if (message.action === 'initialize') {
        await plugin.initialize(message.context);
        process.send!({
          responseId: message.id,
          result: { success: true },
        });
      } else if (message.action) {
        const result = await plugin.execute(message.action, message.payload);
        process.send!({
          responseId: message.id,
          result,
        });
      }
    } catch (error) {
      process.send!({
        responseId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.log('Webchat plugin started and listening for messages');
}