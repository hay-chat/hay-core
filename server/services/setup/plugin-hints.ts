import {
  BUSINESS_TYPES,
  SETUP_HANDLES,
  SETUP_PLUGIN_GROUPS,
  type PluginSetupHints,
} from "@server/types/setup.types";

/**
 * Reads the optional `setup` block of a plugin's `hay-plugin` manifest. Plugins can come from
 * organizations, so anything malformed is dropped rather than trusted. Returns undefined when
 * the block is missing or has no usable group.
 */
export function readSetupHints(raw: unknown): PluginSetupHints | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const block = raw as Record<string, unknown>;

  const group = SETUP_PLUGIN_GROUPS.find((g) => g === block.group);
  if (!group) return undefined;

  const pick = <T extends string>(allowed: readonly T[], value: unknown): T[] =>
    Array.isArray(value) ? allowed.filter((a) => value.includes(a)) : [];

  return {
    group,
    businessTypes: pick(BUSINESS_TYPES, block.businessTypes),
    handles: pick(SETUP_HANDLES, block.handles),
  };
}
