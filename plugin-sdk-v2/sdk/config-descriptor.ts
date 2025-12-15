/**
 * Hay Plugin SDK v2 - Config Descriptor API Implementation
 *
 * Implementation of the config descriptor API for creating field references.
 *
 * @module @hay/plugin-sdk-v2/sdk/config-descriptor
 */

import type {
  HayConfigDescriptorAPI,
  ConfigFieldReference,
} from '../types/index.js';

/**
 * Create a Config Descriptor API instance.
 *
 * This API is used in `onInitialize` to create field references
 * for declarative contexts (e.g., OAuth2 options that reference config fields).
 *
 * @remarks
 * **IMPORTANT**: This API is ONLY for creating field references, NOT for reading values.
 * To read config values, use `HayConfigRuntimeAPI.get()` in org runtime hooks.
 *
 * @returns Config descriptor API implementation
 *
 * @internal
 */
export function createConfigDescriptorAPI(): HayConfigDescriptorAPI {
  return {
    field(name: string): ConfigFieldReference {
      // Validate field name
      if (!name || typeof name !== 'string') {
        throw new Error('Config field name must be a non-empty string');
      }

      if (name.trim().length === 0) {
        throw new Error('Config field name cannot be empty or whitespace');
      }

      // Return a field reference
      // Note: We don't validate that the field exists yet,
      // because config.field() might be called before register.config()
      // Validation happens in auth registration
      return { name };
    },
  };
}
