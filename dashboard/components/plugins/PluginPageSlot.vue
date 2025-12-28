<script setup lang="ts">
/**
 * Plugin Page Slot Component
 *
 * Dynamically loads and renders plugin UI components from built bundles.
 * Handles prop passing, event emitting, loading states, and error boundaries.
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
      <AlertCircle class="h-4 w-4" />
      <AlertTitle>Plugin Component Error</AlertTitle>
      <AlertDescription class="mt-2 space-y-3">
        <div>
          <p class="font-medium">{{ errorMessage }}</p>
          <p class="text-sm mt-1 opacity-90">
            Plugin: <code class="bg-black/10 px-1 rounded">{{ pluginId }}</code> - Component:
            <code class="bg-black/10 px-1 rounded">{{ componentName }}</code>
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
