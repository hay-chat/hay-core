<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex items-center space-x-4">
      <NuxtLink to="/plugins">
        <Button variant="ghost" size="sm">
          <ArrowLeft class="mr-2 h-4 w-4" />
          Back
        </Button>
      </NuxtLink>
      <div class="flex-1">
        <h1 class="text-2xl font-bold text-foreground">
          {{ plugin?.name || "Plugin Configuration" }}
        </h1>
        <p class="mt-1 text-sm text-neutral-muted">
          {{ plugin?.description || "Configure plugin settings and monitor usage" }}
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <div
          :class="[
            'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium',
            plugin?.status === 'active'
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : plugin?.status === 'error'
                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
          ]"
        >
          <div
            :class="[
              'w-2 h-2 rounded-full mr-2',
              plugin?.status === 'active'
                ? 'bg-green-600 dark:bg-green-400'
                : plugin?.status === 'error'
                  ? 'bg-red-600 dark:bg-red-400'
                  : 'bg-gray-600 dark:bg-gray-400',
            ]"
          ></div>
          {{ plugin?.status || "inactive" }}
        </div>
        <Button v-if="plugin?.status === 'active'" variant="outline" @click="togglePlugin">
          <PowerOff class="mr-2 h-4 w-4" />
          Disable
        </Button>
        <Button v-else variant="outline" @click="togglePlugin">
          <Power class="mr-2 h-4 w-4" />
          Enable
        </Button>
      </div>
    </div>

    <!-- Configuration Form -->
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription> Configure API credentials and settings for this plugin </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="saveConfiguration" class="space-y-6">
          <!-- API Key -->
          <div class="space-y-2">
            <Label for="apiKey">API Key</Label>
            <div class="relative">
              <Input
                id="apiKey"
                v-model="config.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="Enter your API key"
                class="pr-20"
              />
              <div class="absolute inset-y-0 right-0 flex items-center pr-3 space-x-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  @click="showApiKey = !showApiKey"
                  class="h-7 px-2"
                >
                  <component :is="showApiKey ? EyeOff : Eye" class="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  @click="generateApiKey"
                  class="h-7 px-2"
                >
                  <RefreshCw class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p class="text-sm text-neutral-muted">Your API key is encrypted and stored securely</p>
          </div>

          <!-- Model Selection (for LLM providers) -->
          <div v-if="isLLMProvider" class="space-y-2">
            <Label for="model">Default Model</Label>
            <select
              id="model"
              v-model="config.model"
              class="w-full px-3 py-2 border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a model</option>
              <option v-for="model in availableModels" :key="model.id" :value="model.id">
                {{ model.name }} ({{ model.contextWindow }} tokens)
              </option>
            </select>
          </div>

          <!-- Endpoint (optional) -->
          <div v-if="showEndpoint" class="space-y-2">
            <Label for="endpoint">API Endpoint (Optional)</Label>
            <Input id="endpoint" v-model="config.endpoint" placeholder="https://api.example.com" />
            <p class="text-sm text-neutral-muted">Custom endpoint URL (leave empty for default)</p>
          </div>

          <!-- Advanced Settings -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Advanced Settings</Label>
              <Button type="button" variant="ghost" size="sm" @click="showAdvanced = !showAdvanced">
                <component :is="showAdvanced ? ChevronUp : ChevronDown" class="h-4 w-4" />
              </Button>
            </div>

            <div v-if="showAdvanced" class="space-y-4 pl-4 border-l-2 border-border">
              <!-- Max Retries -->
              <div class="space-y-2">
                <Label for="maxRetries">Max Retries</Label>
                <Input
                  id="maxRetries"
                  v-model.number="config.maxRetries"
                  type="number"
                  min="0"
                  max="10"
                  placeholder="3"
                />
              </div>

              <!-- Timeout -->
              <div class="space-y-2">
                <Label for="timeout">Timeout (ms)</Label>
                <Input
                  id="timeout"
                  v-model.number="config.timeout"
                  type="number"
                  min="1000"
                  max="300000"
                  placeholder="60000"
                />
              </div>

              <!-- Rate Limit -->
              <div class="space-y-2">
                <Label for="rateLimit">Rate Limit (requests/min)</Label>
                <Input
                  id="rateLimit"
                  v-model.number="config.rateLimitPerMinute"
                  type="number"
                  min="1"
                  max="1000"
                  placeholder="60"
                />
              </div>
            </div>
          </div>

          <!-- Usage Limits -->
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <Label>Usage Limits</Label>
              <Button type="button" variant="ghost" size="sm" @click="showLimits = !showLimits">
                <component :is="showLimits ? ChevronUp : ChevronDown" class="h-4 w-4" />
              </Button>
            </div>

            <div v-if="showLimits" class="space-y-4 pl-4 border-l-2 border-border">
              <!-- Max Requests -->
              <div class="space-y-2">
                <Label for="maxRequests">Max Requests per Month</Label>
                <Input
                  id="maxRequests"
                  v-model.number="limits.maxRequestsPerMonth"
                  type="number"
                  min="0"
                  placeholder="Unlimited"
                />
              </div>

              <!-- Max Cost -->
              <div class="space-y-2">
                <Label for="maxCost">Max Cost per Month ($)</Label>
                <Input
                  id="maxCost"
                  v-model.number="limits.maxCostPerMonth"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unlimited"
                />
              </div>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="flex justify-between pt-6">
            <Button type="button" variant="outline" @click="testConnection" :disabled="testing">
              <Zap class="mr-2 h-4 w-4" />
              {{ testing ? "Testing..." : "Test Connection" }}
            </Button>
            <div class="space-x-2">
              <Button type="button" variant="outline" @click="resetForm"> Cancel </Button>
              <Button type="submit" :disabled="saving">
                {{ saving ? "Saving..." : "Save Changes" }}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- Health Status -->
    <Card v-if="plugin?.healthCheck">
      <CardHeader>
        <CardTitle>Health Status</CardTitle>
        <CardDescription>
          Last checked: {{ formatDate(plugin.healthCheck.lastCheck) }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div class="flex items-center space-x-4">
            <component
              :is="plugin.healthCheck.status === 'healthy' ? CheckCircle : XCircle"
              :class="[
                'h-8 w-8',
                plugin.healthCheck.status === 'healthy'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400',
              ]"
            />
            <div>
              <p class="font-medium">
                {{ plugin.healthCheck.status === "healthy" ? "Healthy" : "Unhealthy" }}
              </p>
              <p class="text-sm text-neutral-muted">
                {{ plugin.healthCheck.message }}
              </p>
            </div>
          </div>

          <div v-if="plugin.healthCheck.details" class="bg-background-tertiary rounded-lg p-4">
            <pre class="text-xs">{{ JSON.stringify(plugin.healthCheck.details, null, 2) }}</pre>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Usage Statistics -->
    <Card v-if="plugin?.usage">
      <CardHeader>
        <CardTitle>Usage Statistics</CardTitle>
        <CardDescription> Track API usage and costs for this plugin </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-6 md:grid-cols-3">
          <!-- Monthly Requests -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-neutral-muted">Requests (This Month)</p>
            <p class="text-2xl font-bold">
              {{ formatNumber(plugin.usage.monthlyUsage?.requests || 0) }}
            </p>
            <Progress
              v-if="limits.maxRequestsPerMonth"
              :value="
                ((plugin.usage.monthlyUsage?.requests || 0) / limits.maxRequestsPerMonth) * 100
              "
              class="h-2"
            />
          </div>

          <!-- Monthly Tokens -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-neutral-muted">Tokens (This Month)</p>
            <p class="text-2xl font-bold">
              {{ formatNumber(plugin.usage.monthlyUsage?.tokens || 0) }}
            </p>
          </div>

          <!-- Monthly Cost -->
          <div class="space-y-2">
            <p class="text-sm font-medium text-neutral-muted">Cost (This Month)</p>
            <p class="text-2xl font-bold">
              ${{ (plugin.usage.monthlyUsage?.cost || 0).toFixed(2) }}
            </p>
            <Progress
              v-if="limits.maxCostPerMonth"
              :value="((plugin.usage.monthlyUsage?.cost || 0) / limits.maxCostPerMonth) * 100"
              class="h-2"
            />
          </div>
        </div>

        <!-- Total Usage -->
        <div class="mt-6 pt-6 border-t border-border">
          <h4 class="text-sm font-medium mb-4">All-Time Usage</h4>
          <div class="grid gap-4 md:grid-cols-3 text-sm">
            <div>
              <span class="text-neutral-muted">Total Requests:</span>
              <span class="ml-2 font-medium">{{
                formatNumber(plugin.usage.totalRequests || 0)
              }}</span>
            </div>
            <div>
              <span class="text-neutral-muted">Total Tokens:</span>
              <span class="ml-2 font-medium">{{
                formatNumber(plugin.usage.totalTokens || 0)
              }}</span>
            </div>
            <div>
              <span class="text-neutral-muted">Total Cost:</span>
              <span class="ml-2 font-medium">${{ (plugin.usage.totalCost || 0).toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  Power,
  PowerOff,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Zap,
  CheckCircle,
  XCircle,
} from "lucide-vue-next";

definePageMeta({
  // // middleware: 'auth'
});

const route = useRoute();
const router = useRouter();

// State
const plugin = ref<any>(null);
const config = ref<any>({
  apiKey: "",
  model: "",
  endpoint: "",
  maxRetries: 3,
  timeout: 60000,
  rateLimitPerMinute: 60,
});
const limits = ref({
  maxRequestsPerMonth: 0,
  maxCostPerMonth: 0,
});
const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const showApiKey = ref(false);
const showAdvanced = ref(false);
const showLimits = ref(false);
const showEndpoint = ref(false);

// Computed
const pluginId = computed(() => route.params["id"] as string);

const isLLMProvider = computed(() => {
  return plugin.value?.type === "llm_provider" || plugin.value?.type === "embedding_provider";
});

const availableModels = computed(() => {
  // TODO: Fetch from plugin metadata
  if (pluginId.value === "openai") {
    return [
      { id: "gpt-4-turbo-preview", name: "GPT-4 Turbo", contextWindow: 128000 },
      { id: "gpt-4", name: "GPT-4", contextWindow: 8192 },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", contextWindow: 16385 },
    ];
  }
  return [];
});

// Methods
const loadPlugin = async () => {};

const saveConfiguration = async () => {};

const testConnection = async () => {};

const togglePlugin = async () => {};

const resetForm = () => {
  if (plugin.value?.configuration) {
    config.value = { ...plugin.value.configuration };
  }
  if (plugin.value?.limits) {
    limits.value = { ...plugin.value.limits };
  }
};

const generateApiKey = () => {
  // This would typically open a modal to the provider's API key generation page
  window.open(getApiKeyUrl(), "_blank");
};

const getApiKeyUrl = () => {
  const urls: Record<string, string> = {
    openai: "https://platform.openai.com/api-keys",
    anthropic: "https://console.anthropic.com/settings/keys",
    cohere: "https://dashboard.cohere.com/api-keys",
  };
  return urls[pluginId.value] || "#";
};

const formatDate = (date: any) => {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
};

const formatNumber = (num: number) => {
  return new Intl.NumberFormat("en-US").format(num);
};

// Lifecycle
onMounted(async () => {
  await loadPlugin();
});

// SEO
useHead({
  title: `${plugin.value?.name || "Plugin"} Configuration - Hay Dashboard`,
  meta: [
    {
      name: "description",
      content: "Configure plugin settings and monitor usage",
    },
  ],
});
</script>
