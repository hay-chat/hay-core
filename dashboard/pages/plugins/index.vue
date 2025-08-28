<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Plugins</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Manage AI providers, vector stores, and document processors
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw
            class="mr-2 h-4 w-4"
            :class="{ 'animate-spin': loading }"
          />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Filter Tabs -->
    <div class="border-b border-border">
      <nav class="-mb-px flex space-x-8" aria-label="Tabs">
        <button
          v-for="category in categories"
          :key="category.id"
          @click="selectedCategory = category.id"
          :class="[
            selectedCategory === category.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors',
          ]"
        >
          {{ category.name }}
          <span
            :class="[
              selectedCategory === category.id
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
              'ml-2 rounded-full px-2 py-0.5 text-xs font-medium',
            ]"
          >
            {{ category.count }}
          </span>
        </button>
      </nav>
    </div>

    <!-- Plugins Grid -->
    <div
      v-if="!loading && filteredPlugins.length > 0"
      class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      <Card
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        :class="[
          'relative overflow-hidden transition-all hover:shadow-lg',
          plugin.status === 'active' ? 'border-green-500/20' : '',
        ]"
      >
        <!-- Status Badge -->
        <div class="absolute top-4 right-4">
          <div
            :class="[
              'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
              plugin.status === 'active'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : plugin.status === 'error'
                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                : plugin.status === 'configuring'
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
            ]"
          >
            <div
              :class="[
                'w-2 h-2 rounded-full mr-1.5',
                plugin.status === 'active'
                  ? 'bg-green-600 dark:bg-green-400'
                  : plugin.status === 'error'
                  ? 'bg-red-600 dark:bg-red-400'
                  : plugin.status === 'configuring'
                  ? 'bg-yellow-600 dark:bg-yellow-400 animate-pulse'
                  : 'bg-gray-600 dark:bg-gray-400',
              ]"
            ></div>
            {{ plugin.status }}
          </div>
        </div>

        <CardHeader>
          <div class="flex items-start space-x-4">
            <div
              :class="[
                'p-3 rounded-lg',
                plugin.available
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              ]"
            >
              <component :is="getPluginIcon(plugin.type)" class="h-6 w-6" />
            </div>
            <div class="flex-1">
              <CardTitle class="text-lg">{{ plugin.name }}</CardTitle>
              <CardDescription class="mt-1">{{
                plugin.description
              }}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <!-- Plugin Details -->
          <div class="space-y-3">
            <!-- Type -->
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Type</span>
              <Badge variant="secondary">{{
                formatPluginType(plugin.type)
              }}</Badge>
            </div>

            <!-- Model/Version -->
            <div
              v-if="plugin.configuration?.model"
              class="flex items-center justify-between text-sm"
            >
              <span class="text-muted-foreground">Model</span>
              <span class="font-medium">{{ plugin.configuration.model }}</span>
            </div>

            <!-- Usage Stats -->
            <div
              v-if="plugin.usage"
              class="flex items-center justify-between text-sm"
            >
              <span class="text-muted-foreground">Usage</span>
              <span class="font-medium">
                {{ formatNumber(plugin.usage.monthlyUsage?.requests || 0) }}
                requests
              </span>
            </div>

            <!-- Cost -->
            <div
              v-if="plugin.usage?.monthlyUsage?.cost"
              class="flex items-center justify-between text-sm"
            >
              <span class="text-muted-foreground">Cost</span>
              <span class="font-medium"
                >${{ plugin.usage.monthlyUsage.cost.toFixed(2) }}</span
              >
            </div>

            <!-- Health Status -->
            <div
              v-if="plugin.healthCheck"
              class="flex items-center justify-between text-sm"
            >
              <span class="text-muted-foreground">Health</span>
              <span
                :class="[
                  'flex items-center',
                  plugin.healthCheck.status === 'healthy'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400',
                ]"
              >
                <component
                  :is="
                    plugin.healthCheck.status === 'healthy'
                      ? CheckCircle
                      : XCircle
                  "
                  class="h-4 w-4 mr-1"
                />
                {{ plugin.healthCheck.status }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="mt-6 flex space-x-2">
            <NuxtLink
              :to="`/plugins/${plugin.pluginId || plugin.id}`"
              class="flex-1"
            >
              <Button variant="outline" class="w-full" size="sm">
                <Settings class="mr-2 h-4 w-4" />
                Configure
              </Button>
            </NuxtLink>
            <Button
              v-if="plugin.status === 'active'"
              variant="ghost"
              size="sm"
              @click="togglePlugin(plugin)"
            >
              <PowerOff class="h-4 w-4" />
            </Button>
            <Button
              v-else-if="plugin.status === 'inactive' && plugin.available"
              variant="ghost"
              size="sm"
              @click="togglePlugin(plugin)"
            >
              <Power class="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!loading && filteredPlugins.length === 0"
      class="text-center py-12"
    >
      <Puzzle class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">No plugins found</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {{
          selectedCategory === "all"
            ? "No plugins are available."
            : `No ${selectedCategory} plugins found.`
        }}
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="i in 6" :key="i" class="animate-pulse">
        <CardHeader>
          <div class="flex items-start space-x-4">
            <div class="p-3 rounded-lg bg-muted">
              <div class="h-6 w-6 bg-muted-foreground/20 rounded"></div>
            </div>
            <div class="flex-1 space-y-2">
              <div class="h-5 bg-muted-foreground/20 rounded w-3/4"></div>
              <div class="h-4 bg-muted-foreground/20 rounded w-full"></div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="h-4 bg-muted-foreground/20 rounded"></div>
            <div class="h-4 bg-muted-foreground/20 rounded"></div>
            <div class="h-4 bg-muted-foreground/20 rounded"></div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Usage Statistics Summary -->
    <Card v-if="stats && !loading">
      <CardHeader>
        <CardTitle>Usage Overview</CardTitle>
        <CardDescription
          >Total usage across all active plugins this month</CardDescription
        >
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">
              Total Requests
            </p>
            <p class="text-2xl font-bold">
              {{ formatNumber(stats.totalRequests) }}
            </p>
          </div>
          <div class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">
              Total Tokens
            </p>
            <p class="text-2xl font-bold">
              {{ formatNumber(stats.totalTokens) }}
            </p>
          </div>
          <div class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">Total Cost</p>
            <p class="text-2xl font-bold">
              ${{ stats.totalCost?.toFixed(2) || "0.00" }}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { $api } = useNuxtApp();

import {
  RefreshCw,
  Settings,
  Power,
  PowerOff,
  Puzzle,
  CheckCircle,
  XCircle,
  Brain,
  Database,
  FileText,
  Layers,
} from "lucide-vue-next";

definePageMeta({
  // // middleware: 'auth'
});

// Types
interface Plugin {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  type: string;
  status: "active" | "inactive" | "error" | "configuring";
  available: boolean;
  configuration?: any;
  metadata?: any;
  healthCheck?: {
    status: "healthy" | "unhealthy" | "unknown";
    lastCheck?: Date;
    message?: string;
  };
  usage?: {
    monthlyUsage?: {
      requests: number;
      tokens: number;
      cost: number;
    };
  };
}

// State
const loading = ref(false);
const selectedCategory = ref("all");
const plugins = ref<Plugin[]>([]);
const availablePlugins = ref<any[]>([]);
const stats = ref<any>(null);

// Categories
const categories = computed(() => {
  const allCount =
    plugins.value.length +
    availablePlugins.value.filter(
      (p) => !plugins.value.find((cp) => cp.pluginId === p.id)
    ).length;
  const llmCount = [...plugins.value, ...availablePlugins.value].filter(
    (p) => p.type === "llm_provider" || p.type === "embedding_provider"
  ).length;
  const vectorCount = [...plugins.value, ...availablePlugins.value].filter(
    (p) => p.type === "vector_store"
  ).length;
  const processorCount = [...plugins.value, ...availablePlugins.value].filter(
    (p) => p.type === "document_processor"
  ).length;

  return [
    { id: "all", name: "All Plugins", count: allCount },
    { id: "llm", name: "AI Providers", count: llmCount },
    { id: "vector", name: "Vector Stores", count: vectorCount },
    { id: "processor", name: "Processors", count: processorCount },
  ];
});

// Computed
const filteredPlugins = computed(() => {
  // Merge configured and available plugins
  const allPlugins: Plugin[] = [
    ...plugins.value,
    ...availablePlugins.value
      .filter((ap) => !plugins.value.find((p) => p.pluginId === ap.id))
      .map((ap) => ({
        id: ap.id,
        pluginId: ap.id,
        name: ap.name,
        description: ap.description,
        type: ap.type,
        status: "inactive" as const,
        available: ap.available,
      })),
  ];

  if (selectedCategory.value === "all") {
    return allPlugins;
  }

  if (selectedCategory.value === "llm") {
    return allPlugins.filter(
      (p) => p.type === "llm_provider" || p.type === "embedding_provider"
    );
  }

  if (selectedCategory.value === "vector") {
    return allPlugins.filter((p) => p.type === "vector_store");
  }

  if (selectedCategory.value === "processor") {
    return allPlugins.filter((p) => p.type === "document_processor");
  }

  return allPlugins;
});

// Methods
const getPluginIcon = (type: string) => {
  switch (type) {
    case "llm_provider":
    case "embedding_provider":
      return Brain;
    case "vector_store":
      return Database;
    case "document_processor":
      return FileText;
    default:
      return Layers;
  }
};

const formatPluginType = (type: string) => {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

const formatNumber = (num: number) => {
  return new Intl.NumberFormat("en-US").format(num);
};

const refreshData = async () => {
  // loading.value = true;
  // try {
  //   // Fetch configured plugins
  //   const { data: configuredPlugins } = await $api('/api/v1/plugins');
  //   plugins.value = configuredPlugins || [];
  //   // Fetch available plugins
  //   const { data: available } = await $api('/api/v1/plugins/available');
  //   availablePlugins.value = available || [];
  //   // Fetch usage stats
  //   const { data: usageStats } = await $api('/api/v1/plugins/stats');
  //   stats.value = usageStats;
  // } catch (error) {
  //   console.error('Error fetching plugins:', error);
  //   // TODO: Show error notification
  // } finally {
  //   loading.value = false;
  // }
};

const togglePlugin = async (plugin: Plugin) => {
  // try {
  //   const endpoint =
  //     plugin.status === "active"
  //       ? `/api/v1/plugins/${plugin.pluginId}/disable`
  //       : `/api/v1/plugins/${plugin.pluginId}/enable`;
  //   await $api(endpoint, {
  //     method: "POST",
  //   });
  //   // Refresh data
  //   await refreshData();
  //   // TODO: Show success notification
  //   console.log(
  //     `Plugin ${
  //       plugin.status === "active" ? "disabled" : "enabled"
  //     } successfully`
  //   );
  // } catch (error) {
  //   console.error("Error toggling plugin:", error);
  //   // TODO: Show error notification
  // }
};

// Lifecycle
onMounted(async () => {
  await refreshData();
});

// SEO
useHead({
  title: "Plugins - Hay Dashboard",
  meta: [
    { name: "description", content: "Manage AI providers and integrations" },
  ],
});
</script>
