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
          </div>
        </CardHeader>
      </Card>

      <!-- Plugin Settings Extensions - Before Settings Slot -->
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
            @update:config="
              (newConfig: any) => {
                formData = { ...formData, ...newConfig };
              }
            "
          />
        </CardContent>
      </Card>

      <!-- Tabs Section: Show tabs if there are any tab extensions -->
      <Card v-if="tabExtensions.length > 0">
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
              <form v-else @submit.prevent="saveConfiguration" class="space-y-4">
                <div v-for="(field, key) in configSchema" :key="key" class="space-y-2">
                  <!-- Text Input -->
                  <template v-if="field.type === 'string' && !field.options">
                    <Label :for="key" :required="field.required">
                      {{ field.label || key }}
                      <Lock
                        v-if="field.encrypted"
                        class="inline-block h-3 w-3 ml-1 text-neutral-muted"
                      />
                    </Label>
                    <p v-if="field.description" class="text-sm text-neutral-muted">
                      {{ field.description }}
                    </p>

                    <!-- Encrypted field with edit mode -->
                    <div
                      v-if="
                        field.encrypted &&
                        originalFormData[key] &&
                        /^\*+$/.test(originalFormData[key])
                      "
                      class="space-y-2"
                    >
                      <div
                        v-if="!editingEncryptedFields.has(key)"
                        class="flex items-center space-x-2"
                      >
                        <Input
                          :id="key"
                          value="••••••••"
                          type="password"
                          disabled
                          class="flex-1 bg-muted"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          @click="
                            () => {
                              editingEncryptedFields.add(key);
                              formData[key] = ''; // Clear the masked value
                              editingEncryptedFields = new Set(editingEncryptedFields);
                            }
                          "
                        >
                          <Edit3 class="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </div>

                      <div v-else class="flex items-center space-x-2">
                        <Input
                          :id="key"
                          v-model="formData[key]"
                          type="password"
                          :placeholder="'Enter new ' + (field.label || key).toLowerCase()"
                          :required="field.required"
                          class="flex-1"
                          autofocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          @click="
                            () => {
                              editingEncryptedFields.delete(key);
                              formData[key] = originalFormData[key]; // Restore masked value
                              editingEncryptedFields = new Set(editingEncryptedFields);
                            }
                          "
                        >
                          <X class="h-4 w-4" />
                        </Button>
                      </div>
                      <p class="text-xs text-neutral-muted">
                        This value is encrypted and stored securely. Click edit to update it.
                      </p>
                    </div>

                    <!-- Regular input or new encrypted field -->
                    <div v-else>
                      <Input
                        :id="key"
                        v-model="formData[key]"
                        :type="field.encrypted ? 'password' : 'text'"
                        :placeholder="
                          field.placeholder || 'Enter ' + (field.label || key).toLowerCase()
                        "
                        :required="field.required"
                      />
                      <p v-if="field.encrypted" class="text-xs text-neutral-muted mt-1">
                        This value will be encrypted and stored securely.
                      </p>
                    </div>
                  </template>

                  <!-- Select -->
                  <template v-else-if="field.type === 'select' || field.options">
                    <Label :for="key" :required="field.required">
                      {{ field.label || key }}
                    </Label>
                    <p v-if="field.description" class="text-sm text-neutral-muted">
                      {{ field.description }}
                    </p>
                    <select
                      :id="key"
                      v-model="formData[key]"
                      class="w-full px-3 py-2 text-sm border border-input rounded-md"
                      :required="field.required"
                    >
                      <option value="">Select {{ (field.label || key).toLowerCase() }}</option>
                      <option
                        v-for="option in field.options"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </template>

                  <!-- Boolean -->
                  <template v-else-if="field.type === 'boolean'">
                    <div class="flex items-center justify-between space-x-2">
                      <div class="space-y-0.5">
                        <Label :for="key">{{ field.label || key }}</Label>
                        <p v-if="field.description" class="text-sm text-neutral-muted">
                          {{ field.description }}
                        </p>
                      </div>
                      <Switch :id="key" v-model="formData[key]" />
                    </div>
                  </template>

                  <!-- Textarea -->
                  <template v-else-if="field.type === 'textarea'">
                    <Label :for="key" :required="field.required">
                      {{ field.label || key }}
                    </Label>
                    <p v-if="field.description" class="text-sm text-neutral-muted">
                      {{ field.description }}
                    </p>
                    <Textarea
                      :id="key"
                      v-model="formData[key]"
                      :placeholder="
                        field.placeholder || 'Enter ' + (field.label || key).toLowerCase()
                      "
                      :rows="4"
                      :required="field.required"
                    />
                  </template>

                  <!-- Number -->
                  <template v-else-if="field.type === 'number'">
                    <Label :for="key" :required="field.required">
                      {{ field.label || key }}
                    </Label>
                    <p v-if="field.description" class="text-sm text-neutral-muted">
                      {{ field.description }}
                    </p>
                    <Input
                      :id="key"
                      v-model.number="formData[key]"
                      type="number"
                      :placeholder="
                        field.placeholder || 'Enter ' + (field.label || key).toLowerCase()
                      "
                      :required="field.required"
                    />
                  </template>
                </div>

                <div class="flex justify-end space-x-2 pt-4">
                  <Button type="button" variant="outline" @click="resetForm"> Reset </Button>
                  <Button type="submit" :disabled="saving">
                    <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
                    Save Configuration
                  </Button>
                </div>
              </form>
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

      <!-- Configuration Form (shown when no tabs are present) -->
      <Card v-if="hasConfiguration && tabExtensions.length === 0">
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
          <form v-else @submit.prevent="saveConfiguration" class="space-y-4">
            <div v-for="(field, key) in configSchema" :key="key" class="space-y-2" :id="key">
              <!-- Text Input -->
              <template v-if="field.type === 'string' && !field.options">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                  <Lock
                    v-if="field.encrypted"
                    class="inline-block h-3 w-3 ml-1 text-neutral-muted"
                  />
                </Label>
                <p v-if="field.description" class="text-sm text-neutral-muted">
                  {{ field.description }}
                </p>

                <!-- Encrypted field with edit mode -->
                <div
                  v-if="
                    field.encrypted && originalFormData[key] && /^\*+$/.test(originalFormData[key])
                  "
                  class="space-y-2"
                >
                  <div v-if="!editingEncryptedFields.has(key)" class="flex items-center space-x-2">
                    <Input
                      :id="key"
                      value="••••••••"
                      type="password"
                      disabled
                      class="flex-1 bg-muted"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      @click="
                        () => {
                          editingEncryptedFields.add(key);
                          formData[key] = ''; // Clear the masked value
                          editingEncryptedFields = new Set(editingEncryptedFields);
                        }
                      "
                    >
                      <Edit3 class="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </div>

                  <div v-else class="flex items-center space-x-2">
                    <Input
                      :id="key"
                      v-model="formData[key]"
                      type="password"
                      :placeholder="'Enter new ' + (field.label || key).toLowerCase()"
                      :required="field.required"
                      class="flex-1"
                      autofocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      @click="
                        () => {
                          editingEncryptedFields.delete(key);
                          formData[key] = originalFormData[key]; // Restore masked value
                          editingEncryptedFields = new Set(editingEncryptedFields);
                        }
                      "
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </div>
                  <p class="text-xs text-neutral-muted">
                    This value is encrypted and stored securely. Click edit to update it.
                  </p>
                </div>

                <!-- Regular input or new encrypted field -->
                <div v-else>
                  <Input
                    :id="key"
                    v-model="formData[key]"
                    :type="field.encrypted ? 'password' : 'text'"
                    :placeholder="
                      field.placeholder || 'Enter ' + (field.label || key).toLowerCase()
                    "
                    :required="field.required"
                  />
                  <p v-if="field.encrypted" class="text-xs text-neutral-muted mt-1">
                    This value will be encrypted and stored securely.
                  </p>
                </div>
              </template>

              <!-- Select -->
              <template v-else-if="field.type === 'select' || field.options">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                </Label>
                <p v-if="field.description" class="text-sm text-neutral-muted">
                  {{ field.description }}
                </p>
                <select
                  :id="key"
                  v-model="formData[key]"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md"
                  :required="field.required"
                >
                  <option value="">Select {{ (field.label || key).toLowerCase() }}</option>
                  <option v-for="option in field.options" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </template>

              <!-- Boolean -->
              <template v-else-if="field.type === 'boolean'">
                <div class="flex items-center justify-between space-x-2">
                  <div class="space-y-0.5">
                    <Label :for="key">{{ field.label || key }}</Label>
                    <p v-if="field.description" class="text-sm text-neutral-muted">
                      {{ field.description }}
                    </p>
                  </div>
                  <Switch :id="key" v-model="formData[key]" />
                </div>
              </template>

              <!-- Textarea -->
              <template v-else-if="field.type === 'textarea'">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                </Label>
                <p v-if="field.description" class="text-sm text-neutral-muted">
                  {{ field.description }}
                </p>
                <Textarea
                  :id="key"
                  v-model="formData[key]"
                  :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
                  :rows="4"
                  :required="field.required"
                />
              </template>

              <!-- Number -->
              <template v-else-if="field.type === 'number'">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                </Label>
                <p v-if="field.description" class="text-sm text-neutral-muted">
                  {{ field.description }}
                </p>
                <Input
                  :id="key"
                  v-model.number="formData[key]"
                  type="number"
                  :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
                  :required="field.required"
                />
              </template>
            </div>

            <div class="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" @click="resetForm"> Reset </Button>
              <Button type="submit" :disabled="saving">
                <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
                Save Configuration
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- Test Connection for Connectors -->
      <Card v-if="plugin.type.includes('connector')">
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
              :class="testResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'"
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
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Plugin Settings Extensions - After Settings Slot -->
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
    </div>
  </Page>
</template>

<script setup lang="ts">
import { markRaw, defineAsyncComponent, computed } from "vue";
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  CheckCircle,
  XCircle,
  Zap,
  MessageSquare,
  Cpu,
  FileText,
  Database,
  Package,
  Edit3,
  X,
  Lock,
} from "lucide-vue-next";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Switch from "@/components/ui/Switch.vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";

// Route and router
const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const toast = useToast();
const runtimeConfig = useRuntimeConfig();

// Plugin ID from route
const pluginId = computed(() => route.params.pluginId as string);

// API Base URL from runtime config with fallback
const apiBaseUrl = computed(() => {
  const url = runtimeConfig.public.apiBaseUrl || "http://localhost:3001";
  return url;
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
const disabling = ref(false);
const showDisableConfirm = ref(false);
const testResult = ref<{ success: boolean; message?: string } | null>(null);
const instanceId = ref<string | null>(null);

// Configuration
const hasConfiguration = ref(false);
const hasCustomTemplate = ref(false);
const configSchema = ref<Record<string, any>>({});
const formData = ref<Record<string, any>>({});
const templateHtml = ref<string | null>(null);
// Track which encrypted fields are being edited
const editingEncryptedFields = ref<Set<string>>(new Set());

// Plugin Extensions for slots
const beforeSettingsExtensions = ref<Array<{ id: string; component: any }>>([]);
const afterSettingsExtensions = ref<Array<{ id: string; component: any }>>([]);
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
  // Extract plugin name from pluginId (remove 'hay-plugin-' prefix if present)
  const pluginName = pluginId.value.replace("hay-plugin-", "");

  // Build the full path from plugin name and componentPath
  // The glob pattern is '../../../../plugins/**/*.vue' so we need to match that
  const fullPath = `../../../../plugins/${pluginName}/${componentPath}`;

  // Check if the component exists in our discovered components
  if (pluginComponents[fullPath]) {
    // Use defineAsyncComponent for proper async loading
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
  // Extract plugin name from pluginId (remove 'hay-plugin-' prefix)
  const pluginName = pluginId.replace("hay-plugin-", "");
  return `http://localhost:3001/plugins/thumbnails/${pluginName}`;
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
    return;
  }

  for (const ext of plugin.value.manifest.settingsExtensions) {
    try {
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
        // Load component using Vite's dynamic imports
        const componentModule = await loadPluginComponent(ext.component);

        if (ext.slot === "tab") {
          targetExtensions.value.push({
            id: `${pluginId.value}-${ext.slot}-${ext.tabName || "tab"}`,
            component: markRaw(componentModule),
            name: ext.tabName || "Tab",
            order: ext.tabOrder,
          });
        } else {
          targetExtensions.value.push({
            id: `${pluginId.value}-${ext.slot}`,
            component: markRaw(componentModule),
          });
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

    // Reload plugin data to refresh the UI
    await fetchPlugin();
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
  testResult.value = null;

  try {
    // TODO: Implement actual connection test endpoint
    await new Promise((resolve) => setTimeout(resolve, 2000));

    testResult.value = {
      success: true,
      message: "Connection established successfully",
    };
  } catch (err) {
    testResult.value = {
      success: false,
      message: "Failed to establish connection. Please check your configuration.",
    };
  } finally {
    testing.value = false;
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

// Lifecycle
onMounted(() => {
  fetchPlugin();
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
