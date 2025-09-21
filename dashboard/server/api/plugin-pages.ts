import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * API endpoint to discover and manage plugin pages dynamically
 * This could be used to inform Nuxt about available plugin pages
 */
export default defineEventHandler(async (event) => {
  const pluginsDir = join(process.cwd(), '..', 'plugins');
  const pluginPages: Record<string, string[]> = {};

  try {
    // Read all plugin directories
    const plugins = await readdir(pluginsDir, { withFileTypes: true });

    for (const plugin of plugins) {
      if (plugin.isDirectory() && plugin.name !== 'base') {
        const pagesDir = join(pluginsDir, plugin.name, 'pages');

        // Check if plugin has pages directory
        if (existsSync(pagesDir)) {
          const pages = await readdir(pagesDir);
          pluginPages[plugin.name] = pages.filter(f => f.endsWith('.vue'));
        }
      }
    }

    return {
      success: true,
      plugins: pluginPages,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to read plugin pages',
    };
  }
});