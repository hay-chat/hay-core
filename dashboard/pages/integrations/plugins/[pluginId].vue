<template>
  <Page width="max">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <Button variant="ghost" size="sm" @click="router.push('/integrations/marketplace')">
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back to Marketplace
        </Button>
      </div>
      <div v-if="!loading && plugin && enabled" class="flex items-center space-x-2">
        <Button
          variant="secondary"
          size="sm"
          @click="showDisableConfirm = true"
          :disabled="disabling"
        >
          <Loader2 v-if="disabling" class="h-4 w-4 mr-2 animate-spin" />
          {{ disabling ? "Disabling..." : "Disable Plugin" }}
        </Button>
      </div>
    </div>

    <!-- Disable Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showDisableConfirm"
      title="Disable Plugin?"
      :description="`Are you sure you want to disable ${plugin?.name || getPluginDisplayName(pluginId)}? This will stop the plugin from being used in your organization.`"
      confirm-text="Disable"
      destructive
      @confirm="handleDisablePlugin"
    />

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <Card>
        <CardHeader>
          <div class="animate-pulse space-y-2">
            <div class="h-6 bg-gray-200 rounded w-1/3"></div>
            <div class="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="animate-pulse space-y-4">
            <div class="h-4 bg-gray-200 rounded w-full"></div>
            <div class="h-4 bg-gray-200 rounded w-3/4"></div>
            <div class="h-10 bg-gray-200 rounded w-full"></div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-12">
      <AlertCircle class="h-12 w-12 text-destructive mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">Failed to load plugin</h3>
      <p class="text-neutral-muted mb-4">{{ error }}</p>
      <Button @click="router.push('/integrations/marketplace')"> Return to Marketplace </Button>
    </div>

    <!-- Plugin Settings -->
    <div v-else-if="plugin" class="space-y-6">
      <!-- Plugin Info Card -->
      <Card>
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-4">
              <div class="w-12 h-12 min-w-12 min-h-12 rounded-lg overflow-hidden">
                <img
                  :src="getPluginThumbnail(plugin.id)"
                  :alt="`${plugin.name} thumbnail`"
                  class="w-full h-full object-cover"
                  @error="handleThumbnailError($event)"
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                />
                <div
                  :class="[
                    'w-full h-full rounded-lg items-center justify-center hidden',
                    getPluginIconBg(plugin.type),
                  ]"
                >
                  <component :is="getPluginIcon(plugin.type)" class="h-6 w-6 text-white" />
                </div>
              </div>
              <div>
                <CardTitle>{{ plugin.name || getPluginDisplayName(plugin.id) }}</CardTitle>
                <CardDescription>{{
                  plugin.description || `Version ${plugin.version}`
                }}</CardDescription>
              </div>
            </div>
            <!-- Connection Status Badge (when enabled) -->
            <div v-if="enabled" class="flex items-center space-x-2">
              <!-- Testing Badge -->
              <div
                v-if="testing && !testResult"
                class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
              >
                <Loader2 class="w-3 h-3 mr-1.5 animate-spin" />
                Testing Connection
              </div>
              <!-- Result Badge -->
              <div
                v-else-if="testResult"
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  testResult.success
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
                ]"
              >
                <div
                  :class="[
                    'w-2 h-2 rounded-full mr-1.5',
                    testResult.success
                      ? 'bg-green-600 dark:bg-green-400'
                      : 'bg-red-600 dark:bg-red-400',
                  ]"
                ></div>
                {{ testResult.success ? "Connected" : "Connection Failed" }}
              </div>
            </div>

            <!-- Enable Button (when not enabled) -->
            <div v-if="!enabled">
              <Button
                @click="handleEnablePlugin"
                :disabled="enabling"
                size="lg"
                :loading="enabling"
              >
                Enable Plugin
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <!-- Plugin Extensions - Before Settings Slot (only when NOT enabled) -->
      <template v-if="!enabled">
        <Card v-for="ext in beforeSettingsExtensions" :key="ext.id">
          <CardContent>
            <component
              :is="ext.component"
              :plugin="plugin"
              :config="{
                instanceId: instanceId,
                organizationId: userStore.activeOrganizationId,
              }"
              :api-base-url="apiBaseUrl"
              v-bind="ext.props || {}"
            />
          </CardContent>
        </Card>
      </template>

      <!-- Connection Error Alert (when enabled and failed) -->
      <Alert
        v-if="enabled && testResult && !testResult.success"
        variant="danger"
        :icon="AlertTriangle"
      >
        <AlertTitle>{{ testResult.message || "Connection failed" }}</AlertTitle>
        <AlertDescription>
          <div
            v-if="testResult.error"
            class="font-mono text-xs bg-red-100 dark:bg-red-900/30 p-3 rounded border border-red-200 dark:border-red-800 mt-2"
          >
            {{ testResult.error }}
          </div>
          <div class="mt-3">
            <Button variant="outline" size="sm" @click="testConnection" :loading="testing">
              Try Again
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      <!-- Plugin Not Enabled - Show Overview -->
      <template v-if="!enabled">
        <!-- Description Card -->
        <Card v-if="plugin.manifest?.description">
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-muted-foreground">{{ plugin.manifest.description }}</p>
          </CardContent>
        </Card>

        <!-- Capabilities Card -->
        <Card v-if="plugin.manifest?.capabilities">
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
            <CardDescription>What this plugin can do</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <!-- Chat Connector Capabilities -->
              <div v-if="plugin.manifest.capabilities.chat_connector" class="space-y-3">
                <div class="flex items-center gap-2">
                  <MessageSquare class="h-5 w-5 text-primary" />
                  <h4 class="font-medium">Chat Connector</h4>
                </div>
                <div class="pl-7 space-y-2 text-sm text-muted-foreground">
                  <div v-if="plugin.manifest.capabilities.chat_connector.features?.send_message">
                    <Check class="inline h-4 w-4 text-green-600 mr-2" />
                    Send messages
                  </div>
                  <div v-if="plugin.manifest.capabilities.chat_connector.features?.receive_message">
                    <Check class="inline h-4 w-4 text-green-600 mr-2" />
                    Receive messages
                  </div>
                  <div
                    v-if="plugin.manifest.capabilities.chat_connector.features?.list_conversations"
                  >
                    <Check class="inline h-4 w-4 text-green-600 mr-2" />
                    List conversations
                  </div>
                </div>
              </div>

              <!-- MCP Connector Capabilities -->
              <div
                v-if="
                  Array.isArray(plugin.manifest.capabilities)
                    ? plugin.manifest.capabilities.includes('mcp')
                    : plugin.manifest.capabilities.mcp
                "
                class="space-y-3"
              >
                <div class="flex items-center gap-2">
                  <Cpu class="h-5 w-5 text-primary" />
                  <h4 class="font-medium">MCP Connector</h4>
                </div>
                <p class="pl-7 text-sm text-muted-foreground">
                  Provides AI tools and resources through Model Context Protocol
                </p>
              </div>

              <!-- Document Importer Capabilities -->
              <div v-if="plugin.manifest.capabilities.document_importer" class="space-y-3">
                <div class="flex items-center gap-2">
                  <FileText class="h-5 w-5 text-primary" />
                  <h4 class="font-medium">Document Importer</h4>
                </div>
                <p class="pl-7 text-sm text-muted-foreground">
                  Import and process documents from external sources
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Available Actions Card (for MCP plugins) -->
        <!-- Note: TypeScript-first plugins don't show tools here as they're registered dynamically -->
        <Card
          v-if="
            !Array.isArray(plugin.manifest.capabilities) &&
            plugin.manifest?.capabilities?.mcp?.tools &&
            plugin.manifest.capabilities.mcp.tools.length > 0
          "
        >
          <CardHeader>
            <CardTitle>Available Actions</CardTitle>
            <CardDescription
              >{{ plugin.manifest.capabilities.mcp.tools.length }} tools available</CardDescription
            >
          </CardHeader>
          <CardContent>
            <div class="grid gap-3">
              <div
                v-for="tool in plugin.manifest.capabilities.mcp.tools"
                :key="tool.name"
                class="flex items-start gap-3 p-3 rounded-lg border border-border"
              >
                <div
                  class="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0"
                >
                  <Zap class="h-4 w-4 text-primary" />
                </div>
                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-sm">{{ tool.label || tool.name }}</h4>
                  <p class="text-xs text-muted-foreground mt-1">{{ tool.description }}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>

      <!-- OAuth Connection Card (show when enabled for OAuth plugins) -->
      <Card v-if="enabled && plugin.manifest?.auth?.type === 'oauth2'">
        <CardContent>
          <PluginOAuthConnection
            :plugin="plugin"
            :config="{
              ...formData,
              instanceId: instanceId,
              organizationId: userStore.activeOrganizationId,
            }"
            :api-base-url="apiBaseUrl"
          />
        </CardContent>
      </Card>

      <!-- Plugin Settings Extensions - Before Settings Slot (only when enabled) -->
      <template v-if="enabled">
        <Card v-for="ext in beforeSettingsExtensions" :key="ext.id">
          <CardContent>
            <component
              :is="ext.component"
              :plugin="plugin"
              :config="{
                ...formData,
                instanceId: instanceId,
                organizationId: userStore.activeOrganizationId,
              }"
              :api-base-url="apiBaseUrl"
              v-bind="ext.props || {}"
              @update:config="
                (newConfig: any) => {
                  formData = { ...formData, ...newConfig };
                }
              "
            />
          </CardContent>
        </Card>
      </template>

      <!-- Tabs Section: Show tabs if there are any tab extensions (only when enabled) -->
      <Card v-if="enabled && tabExtensions.length > 0">
        <CardContent class="p-0">
          <Tabs :default-value="hasConfiguration ? 'settings' : tabExtensions[0]?.id">
            <TabsList class="w-full justify-start rounded-none border-b">
              <!-- Settings Tab (shown when there's configuration and tabs) -->
              <TabsTrigger v-if="hasConfiguration" value="settings">Settings</TabsTrigger>
              <!-- Custom Tab Extensions -->
              <TabsTrigger v-for="tab in sortedTabExtensions" :key="tab.id" :value="tab.id">
                {{ tab.name }}
              </TabsTrigger>
            </TabsList>

            <!-- Settings Tab Content -->
            <TabsContent v-if="hasConfiguration" value="settings" class="p-6">
              <!-- Custom Template (if available) -->
              <div v-if="hasCustomTemplate && templateHtml" v-html="templateHtml"></div>

              <!-- Auto-generated Form -->
              <PluginConfigForm
                v-model:formData="formData"
                v-model:editingEncryptedFields="editingEncryptedFields"
                :configSchema="configSchema"
                :originalFormData="originalFormData"
                :saving="saving"
                @submit="saveConfiguration"
                @reset="resetForm"
              />
            </TabsContent>

            <!-- Custom Tab Contents -->
            <TabsContent
              v-for="tab in sortedTabExtensions"
              :key="tab.id"
              :value="tab.id"
              class="p-6"
            >
              <component
                :is="tab.component"
                :plugin="plugin"
                :config="{
                  ...formData,
                  instanceId: instanceId,
                  organizationId: userStore.activeOrganizationId,
                }"
                :api-base-url="apiBaseUrl"
                @update:config="
                  (newConfig: any) => {
                    formData = { ...formData, ...newConfig };
                  }
                "
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <!-- Configuration Form (shown when no tabs are present and enabled) -->
      <Card v-if="enabled && hasConfiguration && tabExtensions.length === 0">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Configure your
            {{ plugin.name || getPluginDisplayName(plugin.id) }} settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <!-- Custom Template (if available) -->
          <div v-if="hasCustomTemplate && templateHtml" v-html="templateHtml"></div>

          <!-- Auto-generated Form -->
          <PluginConfigForm
            v-model:formData="formData"
            v-model:editingEncryptedFields="editingEncryptedFields"
            :configSchema="configSchema"
            :originalFormData="originalFormData"
            :saving="saving"
            @submit="saveConfiguration"
            @reset="resetForm"
          />
        </CardContent>
      </Card>

      <!-- Test Connection for Connectors (only when enabled) -->
      <Card v-if="enabled && plugin.type.includes('connector')">
        <CardHeader>
          <CardTitle>Connection Test</CardTitle>
          <CardDescription>
            Test your
            {{ plugin.name || getPluginDisplayName(plugin.id) }} connection
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <Button @click="testConnection" :disabled="testing">
              <Zap v-if="!testing" class="h-4 w-4 mr-2" />
              <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
              {{ testing ? "Testing..." : "Test Connection" }}
            </Button>

            <div
              v-if="testResult"
              class="p-4 rounded-lg"
              :class="
                testResult.success
                  ? 'bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200'
              "
            >
              <div class="flex items-center space-x-2">
                <CheckCircle v-if="testResult.success" class="h-5 w-5" />
                <XCircle v-else class="h-5 w-5" />
                <span class="font-medium">
                  {{ testResult.success ? "Connection successful!" : "Connection failed" }}
                </span>
              </div>
              <p v-if="testResult.message" class="mt-2 text-sm">
                {{ testResult.message }}
              </p>
              <p
                v-if="!testResult.success && testResult.error"
                class="mt-2 text-sm font-mono bg-red-100 dark:bg-red-900/30 p-2 rounded border border-red-200 dark:border-red-800"
              >
                {{ testResult.error }}
              </p>
              <p v-if="!testResult.success" class="mt-2 text-xs opacity-75">
                Please check your configuration and try again.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Plugin Settings Extensions - After Settings Slot (only when enabled) -->
      <template v-if="enabled">
        <Card v-for="ext in afterSettingsExtensions" :key="ext.id">
          <CardContent>
            <component
              :is="ext.component"
              :plugin="plugin"
              :config="{
                ...formData,
                instanceId: instanceId,
                organizationId: userStore.activeOrganizationId,
              }"
              :api-base-url="apiBaseUrl"
              @update:config="
                (newConfig: any) => {
                  formData = { ...formData, ...newConfig };
                }
              "
            />
          </CardContent>
        </Card>
      </template>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { markRaw, defineAsyncComponent, computed } from "vue";
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Loader2,
  CheckCircle,
  XCircle,
  Zap,
  MessageSquare,
  Cpu,
  FileText,
  Database,
  Package,
  Check,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";
import PluginOAuthConnection from "@/components/plugins/PluginOAuthConnection.vue";

// Route and router
const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const toast = useToast();
const runtimeConfig = useRuntimeConfig();

// Plugin ID from route (decode in case it contains special characters like /)
const pluginId = computed(() => decodeURIComponent(route.params.pluginId as string));

// API Base URL from runtime config
const apiBaseUrl = computed(() => {
  const { getApiUrl } = useDomain();
  return getApiUrl();
});

// Vite glob imports for automatic plugin component discovery
// Use relative path from this file to plugins directory (4 levels up)
// @ts-ignore - Vite glob import not recognized by TypeScript in Nuxt
const pluginComponents = import.meta.glob<any>("../../../../plugins/**/*.vue", {
  eager: false,
});

// State
const loading = ref(true);
const error = ref<string | null>(null);
const plugin = ref<any>(null);
const enabled = ref(false);
const saving = ref(false);
const testing = ref(false);
const enabling = ref(false);
const disabling = ref(false);
const showDisableConfirm = ref(false);
const testResult = ref<{ success: boolean; message?: string; error?: string } | null>(null);
const instanceId = ref<string | null>(null);
const instanceAuth = ref<any>(null); // Auth config from plugin instance

// Configuration
const hasConfiguration = ref(false);
const hasCustomTemplate = ref(false);
const configSchema = ref<Record<string, any>>({});
const formData = ref<Record<string, any>>({});
const templateHtml = ref<string | null>(null);
// Track which encrypted fields are being edited
const editingEncryptedFields = ref<Set<string>>(new Set());

// Plugin Extensions for slots
const beforeSettingsExtensions = ref<
  Array<{ id: string; component: any; props?: Record<string, any> }>
>([]);
const afterSettingsExtensions = ref<
  Array<{ id: string; component: any; props?: Record<string, any> }>
>([]);
const tabExtensions = ref<Array<{ id: string; component: any; name: string; order?: number }>>([]);
// Track original values to detect changes
const originalFormData = ref<Record<string, any>>({});

// Computed property to sort tab extensions by order
const sortedTabExtensions = computed(() => {
  return [...tabExtensions.value].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return 0;
  });
});

// Helper function to load plugin component dynamically using Vite's glob imports
const loadPluginComponent = async (componentPath: string) => {
  // Check if component is from dashboard (starts with @/)
  if (componentPath.startsWith("@/")) {
    // Dashboard component - use a resolver map for known components
    const componentResolvers: Record<string, () => Promise<any>> = {
      "@/components/plugins/PluginOAuthConnection.vue": () =>
        import("@/components/plugins/PluginOAuthConnection.vue"),
    };

    if (componentResolvers[componentPath]) {
      try {
        const module = await componentResolvers[componentPath]();
        return module.default;
      } catch (error) {
        console.error(`Failed to load dashboard component: ${componentPath}`, error);
        throw new Error(`Dashboard component not found: ${componentPath}. Error: ${error}`);
      }
    } else {
      throw new Error(
        `Dashboard component not registered: ${componentPath}. Available: ${Object.keys(componentResolvers).join(", ")}`,
      );
    }
  }

  // Plugin component - use discovered components
  const pluginName = pluginId.value.replace("hay-plugin-", "");
  const fullPath = `../../../../plugins/${pluginName}/${componentPath}`;

  if (pluginComponents[fullPath]) {
    return defineAsyncComponent(pluginComponents[fullPath]);
  }

  throw new Error(
    `Component not found: ${fullPath}. Available: ${Object.keys(pluginComponents).join(", ")}`,
  );
};

// Methods
const getPluginIcon = (types: string[]) => {
  if (types.includes("channel")) return MessageSquare;
  if (types.includes("mcp-connector")) return Cpu;
  if (types.includes("document_importer")) return FileText;
  if (types.includes("retriever")) return Database;
  return Package;
};

const getPluginIconBg = (types: string[]) => {
  if (types.includes("channel")) return "bg-blue-600";
  if (types.includes("mcp-connector")) return "bg-purple-600";
  if (types.includes("document_importer")) return "bg-green-600";
  if (types.includes("retriever")) return "bg-orange-600";
  return "bg-gray-600";
};

const getPluginDisplayName = (name: string) => {
  return name
    .replace("hay-plugin-", "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getPluginThumbnail = (pluginId: string) => {
  const { getApiUrl } = useDomain();
  return getApiUrl(`/plugins/thumbnails/${encodeURIComponent(pluginId)}`);
};

const handleThumbnailError = (event: Event) => {
  // Hide the image and show the fallback icon
  const imgElement = event.target as HTMLImageElement;
  const fallbackElement = imgElement.nextElementSibling as HTMLElement;

  imgElement.style.display = "none";
  if (fallbackElement) {
    fallbackElement.style.display = "flex";
  }
};

const loadPluginExtensions = async () => {
  // Load settings extensions from plugin manifest if defined
  if (!plugin.value?.manifest?.settingsExtensions) {
    console.log("[PluginSettings] No settingsExtensions found in manifest");
    return;
  }

  console.log("[PluginSettings] Loading extensions:", plugin.value.manifest.settingsExtensions);

  for (const ext of plugin.value.manifest.settingsExtensions) {
    try {
      console.log("[PluginSettings] Processing extension:", ext);

      // Determine which slot array to use
      let targetExtensions: any = null;
      if (ext.slot === "before-settings") {
        targetExtensions = beforeSettingsExtensions;
      } else if (ext.slot === "after-settings") {
        targetExtensions = afterSettingsExtensions;
      } else if (ext.slot === "tab") {
        targetExtensions = tabExtensions;
      } else {
        console.warn(`Unknown slot: ${ext.slot}`);
        continue;
      }

      // Check if the extension has a component file path
      if (ext.component) {
        console.log("[PluginSettings] Loading component:", ext.component);
        // Load component using Vite's dynamic imports
        const componentModule = await loadPluginComponent(ext.component);
        console.log("[PluginSettings] Component loaded:", componentModule);

        if (ext.slot === "tab") {
          targetExtensions.value.push({
            id: `${pluginId.value}-${ext.slot}-${ext.tabName || "tab"}`,
            component: markRaw(componentModule),
            name: ext.tabName || "Tab",
            order: ext.tabOrder,
            props: ext.props || {},
          });
        } else {
          const extensionData = {
            id: `${pluginId.value}-${ext.slot}`,
            component: markRaw(componentModule),
            props: ext.props || {},
          };
          console.log("[PluginSettings] Pushing extension to array:", extensionData);
          targetExtensions.value.push(extensionData);
          console.log(
            "[PluginSettings] beforeSettingsExtensions after push:",
            beforeSettingsExtensions.value,
          );
        }
      }
      // Fallback to inline template if provided (for backward compatibility)
      else if (ext.template) {
        const inlineComponent = markRaw({
          name: `${pluginId.value}-${ext.slot}`,
          template: ext.template,
          props: ["plugin", "config"],
          emits: ["update:config"],
          setup(props: any, { emit }: any) {
            return { plugin: props.plugin, config: props.config };
          },
        });

        if (ext.slot === "tab") {
          targetExtensions.value.push({
            id: `${pluginId.value}-${ext.slot}-${ext.tabName || "tab"}`,
            component: inlineComponent,
            name: ext.tabName || "Tab",
            order: ext.tabOrder,
          });
        } else {
          targetExtensions.value.push({
            id: `${pluginId.value}-${ext.slot}`,
            component: inlineComponent,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to load extension for slot ${ext.slot}:`, err);
    }
  }
};

const fetchPlugin = async () => {
  loading.value = true;
  error.value = null;

  try {
    // Get plugin details
    const pluginData = await Hay.plugins.get.query({
      pluginId: pluginId.value,
    });
    plugin.value = pluginData;

    // Get configuration
    const configData = await Hay.plugins.getConfiguration.query({
      pluginId: pluginId.value,
    });
    enabled.value = configData.enabled;
    instanceId.value = "instanceId" in configData ? configData.instanceId : null;
    formData.value = { ...configData.configuration };
    originalFormData.value = { ...configData.configuration }; // Keep a copy of original values

    // Store runtime auth config from instance
    if ("auth" in configData) {
      instanceAuth.value = configData.auth;
    }

    // Set config schema from manifest
    if (pluginData.manifest?.configSchema) {
      hasConfiguration.value = true;
      configSchema.value = pluginData.manifest.configSchema;

      // Initialize form data with defaults
      Object.entries(configSchema.value).forEach(([key, field]: [string, any]) => {
        if (formData.value[key] === undefined && field.default !== undefined) {
          formData.value[key] = field.default;
        }
      });
    }

    // Check for custom template
    if (pluginData.manifest?.ui?.configuration) {
      try {
        const templateData = await Hay.plugins.getUITemplate.query({
          pluginId: pluginId.value,
        });
        if (templateData.template) {
          hasCustomTemplate.value = true;
          templateHtml.value = templateData.template;
        }
      } catch (err) {
        console.log("No custom template, using auto-generated form");
      }
    }

    // Load plugin extensions after plugin is loaded
    await loadPluginExtensions();
  } catch (err) {
    console.error("Failed to fetch plugin:", err);
    error.value = "Failed to load plugin details";
  } finally {
    loading.value = false;

    // Auto-test connection asynchronously (don't block page load)
    // We check configData here instead of enabled.value because loading.value = false happens after this
    if (enabled.value && hasConfiguration.value && Object.keys(formData.value).length > 0) {
      // Test connection automatically when settings exist (async, non-blocking)
      testConnection();
    }
  }
};

const saveConfiguration = async () => {
  saving.value = true;

  try {
    // Build configuration to send to server
    const cleanedConfig: Record<string, any> = {};

    for (const [key, value] of Object.entries(formData.value)) {
      const field = configSchema.value[key];

      // Handle encrypted fields
      if (
        field?.encrypted &&
        originalFormData.value[key] &&
        /^\*+$/.test(originalFormData.value[key])
      ) {
        // This is an existing encrypted field
        if (editingEncryptedFields.value.has(key) && value && value !== "") {
          // User edited this field, send the new value
          cleanedConfig[key] = value;
        } else if (!editingEncryptedFields.value.has(key)) {
          // User didn't edit this field, send masked value to preserve existing
          cleanedConfig[key] = originalFormData.value[key];
        } else {
          // User clicked edit but didn't enter a value, preserve existing
          cleanedConfig[key] = originalFormData.value[key];
        }
      } else {
        // Regular field or new encrypted field
        cleanedConfig[key] = value;
      }
    }

    await Hay.plugins.configure.mutate({
      pluginId: pluginId.value,
      configuration: cleanedConfig,
    });

    // Clear editing state for encrypted fields
    editingEncryptedFields.value.clear();

    // Show success toast
    toast.success("Configuration saved successfully");

    // Update original form data to reflect new saved state
    originalFormData.value = { ...cleanedConfig };

    // Test connection after saving
    await testConnection();
  } catch (err: any) {
    console.error("Failed to save configuration:", err);

    // Show error toast
    const errorMessage = err?.message || err?.data?.message || "Failed to save configuration";
    toast.error(errorMessage);
  } finally {
    saving.value = false;
  }
};

const resetForm = async () => {
  // Reload configuration from server
  const configData = await Hay.plugins.getConfiguration.query({
    pluginId: pluginId.value,
  });
  formData.value = { ...configData.configuration };
  originalFormData.value = { ...configData.configuration };
  // Clear any editing state for encrypted fields
  editingEncryptedFields.value.clear();
};

const testConnection = async () => {
  testing.value = true;
  // Don't clear testResult immediately - keep showing previous result while testing

  try {
    const result = await Hay.plugins.testConnection.query({ pluginId: pluginId.value });

    testResult.value = {
      success: result.success,
      message:
        result.message ||
        (result.success ? "Connection established successfully" : "Connection failed"),
      error: result.error, // Include detailed error information
    };
  } catch (err: any) {
    testResult.value = {
      success: false,
      message: err?.message || "Failed to establish connection. Please check your configuration.",
    };
  } finally {
    testing.value = false;
  }
};

const handleEnablePlugin = async () => {
  enabling.value = true;

  try {
    await Hay.plugins.configure.mutate({
      pluginId: pluginId.value,
      configuration: {},
    });

    toast.success("Plugin enabled successfully");

    // Reload plugin data to show settings
    await fetchPlugin();
  } catch (err: any) {
    console.error("Failed to enable plugin:", err);

    const errorMessage = err?.message || err?.data?.message || "Failed to enable plugin";
    toast.error(errorMessage);
  } finally {
    enabling.value = false;
  }
};

const handleDisablePlugin = async () => {
  disabling.value = true;

  try {
    await Hay.plugins.disable.mutate({
      pluginId: pluginId.value,
    });

    toast.success("Plugin disabled successfully");

    // Redirect back to marketplace after disabling
    router.push("/integrations/marketplace");
  } catch (err: any) {
    console.error("Failed to disable plugin:", err);

    const errorMessage = err?.message || err?.data?.message || "Failed to disable plugin";
    toast.error(errorMessage);
  } finally {
    disabling.value = false;
  }
};

// Handle OAuth callback redirect
const handleOAuthCallback = () => {
  const oauthStatus = route.query.oauth as string | undefined;

  if (oauthStatus === "success") {
    toast.success("OAuth connection established successfully");

    // Clean up URL by removing query params
    router.replace({
      path: route.path,
      query: {},
    });

    // Reload plugin data to refresh OAuth connection status
    fetchPlugin();
  } else if (oauthStatus === "error") {
    toast.error("OAuth connection failed. Please try again.");

    // Clean up URL
    router.replace({
      path: route.path,
      query: {},
    });
  }
};

// Lifecycle
onMounted(() => {
  // Check for OAuth callback first
  handleOAuthCallback();

  // Then fetch plugin normally
  if (!route.query.oauth) {
    fetchPlugin();
  }
});

// Page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: computed(() =>
    plugin.value
      ? `${getPluginDisplayName(plugin.value.name)} Settings - Hay Dashboard`
      : "Plugin Settings - Hay Dashboard",
  ),
});
</script>
