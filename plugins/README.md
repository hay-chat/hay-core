# Hay Plugins

This directory contains plugins that extend Hay's functionality.

## Plugin Structure

- `base/` - Base classes and types for all plugins (built automatically with server)
- `webchat/` - Web chat widget plugin
- `zendesk/` - Zendesk integration plugin

## Building Plugins

### Base Plugin
The base plugin is automatically built when you build the server (`npm run build:server`). You don't need to build it separately.

### Individual Plugins
Plugins are loaded dynamically and should be built on-demand when needed:

```bash
# Build a specific plugin when you need it
cd plugins/webchat
npm run build

# Or for zendesk
cd plugins/zendesk
npm run build
```

### When to Build Plugins

1. **Before deploying** a plugin to production
2. **After making changes** to a plugin's TypeScript code
3. **When explicitly enabling** a plugin for an organization

Plugins are NOT built automatically with the main build process since:
- They are loaded dynamically based on configuration
- Not all plugins may be used in all deployments
- Building on-demand keeps the build process faster

## Development

During development (`npm run dev`), TypeScript files are used directly, so you don't need to build plugins unless testing production behavior.

## Production

In production, plugins must be built to generate JavaScript files in their `dist/` folders. The server will automatically look for compiled files in `dist/manifest.js`.

## Adding a New Plugin

1. Create a new directory under `plugins/`
2. Add a `manifest.ts` file that exports your plugin configuration
3. Add a `tsconfig.json` that extends the base configuration:
   ```json
   {
     "extends": "../tsconfig.base.json",
     "include": ["*.ts"]
   }
   ```
4. Add a `package.json` with a build script:
   ```json
   {
     "scripts": {
       "build": "tsc"
     }
   }
   ```
5. Build your plugin when ready to use it

## TypeScript Configuration

All plugins extend from `plugins/tsconfig.base.json` which provides common TypeScript settings. This ensures consistency across all plugins and reduces configuration duplication. Plugins only need to specify their unique settings like paths, references, or includes.

## Notes

- All `dist/` folders are gitignored to keep the repository clean
- The base plugin provides shared types and classes for all plugins
- Plugins can have their own dependencies and build processes