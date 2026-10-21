<script setup lang="ts">
/**
 * Plugin Page Slot Component
 *
 * Dynamically loads and renders plugin UI components from built bundles.
 * Handles prop passing, event emitting, loading states, and error boundaries.
 *
 * Props every plugin component receives:
 * - `plugin`: plugin metadata object
 * - `config`: current plugin configuration (form data)
 * - `apiBaseUrl`: API base URL for plain HTTP calls
 * - `api`: the dashboard tRPC client (`Hay`), authenticated and scoped to the
 *   logged-in user's organization, e.g. `api.plugins.oauth.status.query(...)` or
 *   `api.plugins.callUiRoute.mutate({ pluginId, method: "GET", path: "/ui/status" })`
 *   to reach the plugin worker's own `/ui/*` routes (a mutation for GET and POST)
 * - `locale`: current dashboard locale (e.g. "en", "pt-BR")
 *
 * Plugin components may emit `update:config` with a partial config object.
 *
 * @example
 * ```vue
 * <PluginPageSlot
 *   plugin-id="zendesk"
 *   component-name="AfterSettings"
 *   :plugin="plugin"
 *   :config="formData"
 *   @update:config="handleConfigUpdate"
 * />
 * ```
 */

import { ref, onErrorCaptured, Suspense } from "vue";
import { usePluginRegistry } from "@/composables/usePluginRegistry";
import { Loader2, AlertCircle } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { Hay } from "@/utils/api";

interface Props {
  /** Plugin identifier (e.g., 'zendesk', 'shopify') */
  pluginId: string;

  /** Component name as exported from plugin bundle (e.g., 'AfterSettings') */
  componentName: string;

  /** Plugin source path from registry (e.g., 'plugins/core/zendesk') */
  pluginPath?: string;

  /** Plugin metadata object */
  plugin?: any;

  /** Plugin configuration object */
  config?: any;

  /** API base URL for plugin HTTP calls */
  apiBaseUrl?: string;
}

const props = withDefaults(defineProps<Props>(), {
  apiBaseUrl: "http://localhost:3001",
});

const emit = defineEmits<{
  "update:config": [value: any];
}>();

const pluginRegistry = usePluginRegistry();
const { locale } = useI18n({ useScope: "global" });

// Error state
const hasError = ref(false);
const errorMessage = ref<string | null>(null);

// Load the plugin component dynamically
const PluginComponent = pluginRegistry.loadPluginComponent(
  props.pluginId,
  props.componentName,
  props.pluginPath,
);

// Capture runtime errors from the plugin component
onErrorCaptured((error: Error) => {
  console.error("[PluginPageSlot] Runtime error in plugin component:", error);
  hasError.value = true;
  errorMessage.value = `Plugin component error: ${error.message}`;
  // Return false to prevent error propagation
  return false;
});

// Refresh page handler
const refreshPage = () => {
  window.location.reload();
};
</script>

<template>
  <div class="plugin-page-slot">
    <!-- Error state from runtime errors -->
    <Alert v-if="hasError" variant="destructive">
      <AlertTitle>Plugin Component Error</AlertTitle>
      <AlertDescription class="mt-2 space-y-3">
        <div>
          <p class="font-medium">{{ errorMessage }}</p>
          <p class="text-sm mt-1 opacity-90">
            Plugin: <code>{{ pluginId }}</code> - Component:
            <code>{{ componentName }}</code>
          </p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="refreshPage"> Refresh Page </Button>
        </div>
      </AlertDescription>
    </Alert>

    <!-- Use Suspense to handle async component loading -->
    <Suspense v-else>
      <!-- Loaded state: render the plugin component -->
      <template #default>
        <component
          v-if="PluginComponent"
          :is="PluginComponent"
          :plugin="plugin"
          :config="config"
          :api-base-url="apiBaseUrl"
          :api="Hay"
          :locale="locale"
          @update:config="emit('update:config', $event)"
        />
        <Alert v-else variant="destructive">
          <AlertCircle class="h-4 w-4" />
          <AlertTitle>Failed to load plugin component</AlertTitle>
          <AlertDescription class="mt-2">
            <p class="font-medium">Component not found</p>
            <p class="text-sm mt-1 opacity-90">
              Plugin: <code class="bg-black/10 px-1 rounded">{{ pluginId }}</code> - Component:
              <code class="bg-black/10 px-1 rounded">{{ componentName }}</code>
            </p>
            <Button variant="outline" size="sm" class="mt-3" @click="refreshPage">
              Refresh Page
            </Button>
          </AlertDescription>
        </Alert>
      </template>

      <!-- Loading state -->
      <template #fallback>
        <div class="plugin-loading">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          <p class="mt-2 text-sm text-muted-foreground">
            Loading plugin component "{{ componentName }}"...
          </p>
        </div>
      </template>
    </Suspense>
  </div>
</template>

<style scoped>
.plugin-page-slot {
  width: 100%;
}

.plugin-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  text-align: center;
}
</style>
