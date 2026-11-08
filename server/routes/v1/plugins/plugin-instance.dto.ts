import type { PluginInstance } from "@server/entities/plugin-instance.entity";

/**
 * What clients may see of a plugin instance. The entity decrypts `authState` on
 * load and `config` can hold provider secrets, so entities never leave the server.
 */
export function toPluginInstanceDto(instance: PluginInstance) {
  return {
    id: instance.id,
    pluginId: instance.pluginId,
    organizationId: instance.organizationId,
    enabled: instance.enabled,
    runtimeState: instance.runtimeState,
    authMethod: instance.authState?.methodId ?? instance.authMethod ?? null,
    authValidatedAt: instance.authValidatedAt ?? null,
    channelHealth: instance.channelHealth ?? null,
  };
}
