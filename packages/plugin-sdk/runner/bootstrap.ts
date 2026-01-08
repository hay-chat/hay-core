/**
 * Hay Plugin SDK - Runner Bootstrap
 *
 * Handles command-line argument parsing and manifest validation.
 *
 * @module @hay/plugin-sdk/runner/bootstrap
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { HayPluginManifest, HayPluginPackageJson } from '../types/index.js';

/**
 * Runner mode.
 *
 * - `production`: Load config/auth from env vars (HAY_ORG_CONFIG, HAY_ORG_AUTH)
 * - `test`: Use mock data for testing
 */
export type RunnerMode = 'production' | 'test';

/**
 * Parsed command-line arguments for the runner.
 */
export interface RunnerArgs {
  /**
   * Absolute path to the plugin directory (e.g., /path/to/plugins/stripe)
   */
  pluginPath: string;

  /**
   * Organization ID for this plugin instance
   */
  orgId: string;

  /**
   * Port number for the HTTP server
   */
  port: number;

  /**
   * Runner mode (production or test)
   */
  mode: RunnerMode;
}

/**
 * Parsed manifest with validated structure.
 */
export interface ValidatedManifest {
  /**
   * Package.json metadata
   */
  packageJson: HayPluginPackageJson;

  /**
   * Validated hay-plugin manifest
   */
  manifest: HayPluginManifest;

  /**
   * Absolute path to plugin entry file
   */
  entryPath: string;
}

/**
 * Parse command-line arguments.
 *
 * @param argv - Process argv array (typically process.argv)
 * @returns Parsed arguments
 * @throws Error if required args are missing or invalid
 *
 * @example
 * ```typescript
 * const args = parseArgs(process.argv);
 * console.log(args.pluginPath, args.orgId, args.port);
 * ```
 */
export function parseArgs(argv: string[]): RunnerArgs {
  const args: Partial<RunnerArgs> = {
    mode: 'production', // default
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== 'string') continue;

    if (arg.startsWith('--plugin-path=')) {
      const value = arg.split('=')[1];
      if (!value) throw new Error('--plugin-path requires a value');
      args.pluginPath = value;
    } else if (arg.startsWith('--org-id=')) {
      const value = arg.split('=')[1];
      if (!value) throw new Error('--org-id requires a value');
      args.orgId = value;
    } else if (arg.startsWith('--port=')) {
      const value = arg.split('=')[1];
      if (!value) throw new Error('--port requires a value');
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port number: ${value}`);
      }
      args.port = port;
    } else if (arg.startsWith('--mode=')) {
      const value = arg.split('=')[1];
      if (!value) throw new Error('--mode requires a value');
      const mode = value as RunnerMode;
      if (mode !== 'production' && mode !== 'test') {
        throw new Error(`Invalid mode: ${mode}. Must be 'production' or 'test'.`);
      }
      args.mode = mode;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // Validate required args
  if (!args.pluginPath) {
    throw new Error('Missing required argument: --plugin-path');
  }
  if (!args.orgId) {
    throw new Error('Missing required argument: --org-id');
  }
  if (!args.port) {
    throw new Error('Missing required argument: --port');
  }

  return args as RunnerArgs;
}

/**
 * Load and validate plugin manifest from package.json.
 *
 * @param pluginPath - Absolute path to plugin directory
 * @returns Validated manifest with entry path
 * @throws Error if package.json is missing, malformed, or invalid
 *
 * @remarks
 * This function:
 * 1. Reads package.json from plugin directory
 * 2. Validates the `hay-plugin` block exists and has required fields
 * 3. Resolves the entry file path
 * 4. Returns validated manifest
 *
 * @see PLUGIN.md Section 2 (lines 58-92)
 */
export function loadManifest(pluginPath: string): ValidatedManifest {
  const packageJsonPath = resolve(pluginPath, 'package.json');

  let packageJson: any;
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Failed to load package.json from ${packageJsonPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // Validate hay-plugin block exists
  if (!packageJson['hay-plugin']) {
    throw new Error(
      `Missing "hay-plugin" field in package.json at ${packageJsonPath}`
    );
  }

  const manifest = packageJson['hay-plugin'] as HayPluginManifest;

  // Validate required fields
  if (!manifest.entry || typeof manifest.entry !== 'string') {
    throw new Error('Missing or invalid "entry" field in hay-plugin manifest');
  }

  if (!manifest.displayName || typeof manifest.displayName !== 'string') {
    throw new Error(
      'Missing or invalid "displayName" field in hay-plugin manifest'
    );
  }

  if (!manifest.category || typeof manifest.category !== 'string') {
    throw new Error('Missing or invalid "category" field in hay-plugin manifest');
  }

  const validCategories = ['integration', 'channel', 'tool', 'analytics'];
  if (!validCategories.includes(manifest.category)) {
    throw new Error(
      `Invalid category "${manifest.category}". Must be one of: ${validCategories.join(', ')}`
    );
  }

  if (!Array.isArray(manifest.capabilities)) {
    throw new Error(
      'Missing or invalid "capabilities" field in hay-plugin manifest (must be an array)'
    );
  }

  const validCapabilities = ['routes', 'mcp', 'auth', 'config', 'ui'];
  for (const cap of manifest.capabilities) {
    if (!validCapabilities.includes(cap)) {
      throw new Error(
        `Invalid capability "${cap}". Must be one of: ${validCapabilities.join(', ')}`
      );
    }
  }

  // Validate env (optional)
  if (manifest.env !== undefined) {
    if (!Array.isArray(manifest.env)) {
      throw new Error(
        'Invalid "env" field in hay-plugin manifest (must be an array of strings)'
      );
    }
    for (const envVar of manifest.env) {
      if (typeof envVar !== 'string') {
        throw new Error(
          `Invalid env var in manifest: ${envVar} (must be a string)`
        );
      }
    }
  }

  // Resolve entry path
  const entryPath = resolve(pluginPath, manifest.entry);

  return {
    packageJson: packageJson as HayPluginPackageJson,
    manifest,
    entryPath,
  };
}
