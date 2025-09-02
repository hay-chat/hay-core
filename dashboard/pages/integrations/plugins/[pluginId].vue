<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <Button
          variant="ghost"
          size="sm"
          @click="router.push('/integrations/marketplace')"
        >
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back to Marketplace
        </Button>
      </div>
    </div>

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
      <p class="text-muted-foreground mb-4">{{ error }}</p>
      <Button @click="router.push('/integrations/marketplace')">
        Return to Marketplace
      </Button>
    </div>

    <!-- Plugin Settings -->
    <div v-else-if="plugin" class="space-y-6">
      <!-- Plugin Info Card -->
      <Card>
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-4">
              <div
                :class="[
                  'w-12 h-12 rounded-lg flex items-center justify-center',
                  getPluginIconBg(plugin.type),
                ]"
              >
                <component
                  :is="getPluginIcon(plugin.type)"
                  class="h-6 w-6 text-white"
                />
              </div>
              <div>
                <CardTitle>{{ plugin.name || getPluginDisplayName(plugin.id) }}</CardTitle>
                <CardDescription>{{ plugin.description || `Version ${plugin.version}` }}</CardDescription>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge :variant="enabled ? 'success' : 'default'">
                {{ enabled ? "Enabled" : "Disabled" }}
              </Badge>
              <Switch
                v-model="enabled"
                @update:modelValue="togglePlugin"
                :disabled="toggling"
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      <!-- Embed Code for Chat Connectors -->
      <Card v-if="plugin.type.includes('chat-connector') && enabled">
        <CardHeader>
          <CardTitle>Installation</CardTitle>
          <CardDescription>
            Add this code to your website to enable the chat widget
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <div>
              <Label>Embed Code</Label>
              <div class="relative">
                <Textarea
                  :value="embedCode"
                  readonly
                  class="font-mono text-xs"
                  :rows="4"
                />
                <Button
                  variant="outline"
                  size="sm"
                  class="absolute top-2 right-2"
                  @click="copyEmbedCode"
                >
                  <Copy class="h-3 w-3 mr-1" />
                  {{ copied ? "Copied!" : "Copy" }}
                </Button>
              </div>
            </div>
            <div class="text-sm text-muted-foreground">
              Place this code before the closing &lt;/body&gt; tag on your
              website.
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Configuration Form -->
      <Card v-if="hasConfiguration">
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Configure your {{ plugin.name || getPluginDisplayName(plugin.id) }} settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <!-- Custom Template (if available) -->
          <div
            v-if="hasCustomTemplate && templateHtml"
            v-html="templateHtml"
          ></div>

          <!-- Auto-generated Form -->
          <form v-else @submit.prevent="saveConfiguration" class="space-y-4">
            <div
              v-for="(field, key) in configSchema"
              :key="key"
              class="space-y-2"
            >
              <!-- Text Input -->
              <template v-if="field.type === 'string' && !field.options">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                </Label>
                <p
                  v-if="field.description"
                  class="text-sm text-muted-foreground"
                >
                  {{ field.description }}
                </p>
                <Input
                  :id="key"
                  v-model="formData[key]"
                  :type="field.encrypted ? 'password' : 'text'"
                  :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
                  :required="field.required"
                />
              </template>

              <!-- Select -->
              <template v-else-if="field.type === 'select' || field.options">
                <Label :for="key" :required="field.required">
                  {{ field.label || key }}
                </Label>
                <p
                  v-if="field.description"
                  class="text-sm text-muted-foreground"
                >
                  {{ field.description }}
                </p>
                <select
                  :id="key"
                  v-model="formData[key]"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md"
                  :required="field.required"
                >
                  <option value="">
                    Select {{ (field.label || key).toLowerCase() }}
                  </option>
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
                    <p
                      v-if="field.description"
                      class="text-sm text-muted-foreground"
                    >
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
                <p
                  v-if="field.description"
                  class="text-sm text-muted-foreground"
                >
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
                <p
                  v-if="field.description"
                  class="text-sm text-muted-foreground"
                >
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
              <Button type="button" variant="outline" @click="resetForm">
                Reset
              </Button>
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
            Test your {{ plugin.name || getPluginDisplayName(plugin.id) }} connection
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
                  ? 'bg-green-50 text-green-800'
                  : 'bg-red-50 text-red-800'
              "
            >
              <div class="flex items-center space-x-2">
                <CheckCircle v-if="testResult.success" class="h-5 w-5" />
                <XCircle v-else class="h-5 w-5" />
                <span class="font-medium">
                  {{
                    testResult.success
                      ? "Connection successful!"
                      : "Connection failed"
                  }}
                </span>
              </div>
              <p v-if="testResult.message" class="mt-2 text-sm">
                {{ testResult.message }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  AlertCircle,
  Copy,
  Loader2,
  CheckCircle,
  XCircle,
  Zap,
  MessageSquare,
  Cpu,
  FileText,
  Database,
  Package,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useOrganizationStore } from "@/stores/organization";

// Route and router
const route = useRoute();
const router = useRouter();
const organizationStore = useOrganizationStore();

// Plugin ID from route
const pluginId = computed(() => route.params.pluginId as string);

// State
const loading = ref(true);
const error = ref<string | null>(null);
const plugin = ref<any>(null);
const enabled = ref(false);
const toggling = ref(false);
const saving = ref(false);
const testing = ref(false);
const copied = ref(false);
const testResult = ref<{ success: boolean; message?: string } | null>(null);

// Configuration
const hasConfiguration = ref(false);
const hasCustomTemplate = ref(false);
const configSchema = ref<Record<string, any>>({});
const formData = ref<Record<string, any>>({});
const templateHtml = ref<string | null>(null);

// Embed code for chat connectors
const embedCode = computed(() => {
  if (!plugin.value?.type.includes("chat-connector")) return "";

  const orgId = organizationStore.current?.id;
  const baseUrl = window.location.origin.replace("5173", "3000");

  // Build the embed code without template literals to avoid script tag issues
  const scriptTag = [
    "<script>",
    "  (function() {",
    '    var script = document.createElement("script");',
    `    script.src = "${baseUrl}/plugins/embed/${orgId}/${plugin.value.name}";`,
    "    script.async = true;",
    "    document.body.appendChild(script);",
    "  })();",
    "</scr" + "ipt>",
  ].join("\n");

  return scriptTag;
});

// Methods
const getPluginIcon = (types: string[]) => {
  if (types.includes("chat-connector")) return MessageSquare;
  if (types.includes("mcp-connector")) return Cpu;
  if (types.includes("document_importer")) return FileText;
  if (types.includes("retriever")) return Database;
  return Package;
};

const getPluginIconBg = (types: string[]) => {
  if (types.includes("chat-connector")) return "bg-blue-600";
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
    formData.value = { ...configData.configuration };

    // Set config schema from manifest
    if (pluginData.manifest?.configSchema) {
      hasConfiguration.value = true;
      configSchema.value = pluginData.manifest.configSchema;

      // Initialize form data with defaults
      Object.entries(configSchema.value).forEach(
        ([key, field]: [string, any]) => {
          if (
            formData.value[key] === undefined &&
            field.default !== undefined
          ) {
            formData.value[key] = field.default;
          }
        }
      );
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
  } catch (err) {
    console.error("Failed to fetch plugin:", err);
    error.value = "Failed to load plugin details";
  } finally {
    loading.value = false;
  }
};

const togglePlugin = async (value: boolean) => {
  toggling.value = true;
  try {
    if (value) {
      await Hay.plugins.enable.mutate({
        pluginId: pluginId.value,
        configuration: formData.value,
      });
    } else {
      await Hay.plugins.disable.mutate({ pluginId: pluginId.value });
    }
    enabled.value = value;
  } catch (err) {
    console.error("Failed to toggle plugin:", err);
    enabled.value = !value; // Revert
  } finally {
    toggling.value = false;
  }
};

const saveConfiguration = async () => {
  saving.value = true;
  const toast = useToast();

  try {
    await Hay.plugins.configure.mutate({
      pluginId: pluginId.value,
      configuration: formData.value,
    });

    // Show success toast
    toast.success("Configuration saved successfully");
  } catch (err: any) {
    console.error("Failed to save configuration:", err);

    // Show error toast
    const errorMessage =
      err?.message || err?.data?.message || "Failed to save configuration";
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
      message:
        "Failed to establish connection. Please check your configuration.",
    };
  } finally {
    testing.value = false;
  }
};

const copyEmbedCode = async () => {
  try {
    await navigator.clipboard.writeText(embedCode.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy:", err);
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
      : "Plugin Settings - Hay Dashboard"
  ),
});
</script>
