<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Plugin Marketplace</h1>
        <p class="text-muted-foreground">
          Discover and install plugins to extend your platform capabilities
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="refreshPlugins">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <MetricCard
        title="Total Plugins"
        :metric="stats.total"
        subtitle="Available plugins"
        :icon="Package"
      />
      <MetricCard
        title="Enabled"
        :metric="stats.enabled"
        subtitle="Active plugins"
        :icon="CheckCircle"
        subtitle-color="green"
      />
      <MetricCard
        title="Channels"
        :metric="stats.chatConnectors"
        subtitle="Communication channels"
        :icon="MessageSquare"
      />
      <MetricCard
        title="MCP Connectors"
        :metric="stats.mcpConnectors"
        subtitle="Model Context Protocol"
        :icon="Cpu"
      />
    </div>

    <!-- Categories -->
    <div class="flex items-center space-x-2">
      <span class="text-sm font-medium">Categories:</span>
      <div class="flex space-x-2 flex-wrap gap-2">
        <Button
          v-for="category in categories"
          :key="category.id"
          :variant="selectedCategory === category.id ? 'default' : 'outline'"
          size="sm"
          @click="selectedCategory = category.id"
        >
          <component :is="category.icon" class="h-4 w-4 mr-2" />
          {{ category.name }}
        </Button>
      </div>
    </div>

    <!-- Search -->
    <div class="flex items-center space-x-4">
      <div class="relative flex-1 max-w-sm">
        <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input v-model="searchQuery" placeholder="Search plugins..." class="pl-8" />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="animate-pulse">
        <Card>
          <CardHeader>
            <div class="h-4 bg-gray-200 rounded w-1/3" />
            <div class="h-3 bg-gray-200 rounded w-2/3 mt-2" />
          </CardHeader>
          <CardContent>
            <div class="h-3 bg-gray-200 rounded w-full" />
            <div class="h-3 bg-gray-200 rounded w-1/2 mt-2" />
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredPlugins.length === 0" class="text-center py-12">
      <Package class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">No plugins found</h3>
      <p class="text-muted-foreground">
        {{
          searchQuery
            ? "Try adjusting your search terms."
            : "No plugins match your selected category."
        }}
      </p>
    </div>

    <!-- Plugins Grid -->
    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        class="hover:shadow-md transition-shadow"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-12 h-12 min-w-12 min-h-12 rounded-lg overflow-hidden">
                <img
                  :src="getPluginThumbnail(plugin.id)"
                  :alt="`${plugin.name} thumbnail`"
                  class="w-full h-full object-cover"
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
                  @error="handleThumbnailError($event)"
                />
              </div>
              <div>
                <CardTitle class="text-lg">
                  {{ plugin.name }}
                </CardTitle>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <!-- Plugin Type Badges -->
            <div class="flex flex-wrap gap-1">
              <Badge v-for="type in plugin.type" :key="type" variant="outline" class="text-xs">
                {{ formatPluginType(type) }}
              </Badge>
            </div>

            <!-- Status -->
            <div class="space-y-2 text-sm">
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Status:</span>
                <Badge :variant="plugin.enabled ? 'default' : 'secondary'">
                  {{ plugin.enabled ? "Enabled" : "Disabled" }}
                </Badge>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Version:</span>
                <span class="font-medium">{{ plugin.version }}</span>
              </div>
            </div>

            <!-- Features for channels -->
            <div v-if="plugin.type.includes('channel')" class="space-y-2">
              <div class="text-sm font-medium">Features:</div>
              <div class="flex flex-wrap gap-1">
                <Badge v-if="plugin.features?.fileUpload" variant="outline" class="text-xs">
                  File Upload
                </Badge>
                <Badge v-if="plugin.features?.typing" variant="outline" class="text-xs">
                  Typing Indicators
                </Badge>
                <Badge v-if="plugin.features?.readReceipts" variant="outline" class="text-xs">
                  Read Receipts
                </Badge>
                <Badge v-if="plugin.features?.voiceMessages" variant="outline" class="text-xs">
                  Voice Messages
                </Badge>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex space-x-2">
              <Button
                v-if="!plugin.enabled"
                size="sm"
                :disabled="enablingPlugin === plugin.id"
                @click="enablePlugin(plugin.id)"
              >
                <Plug class="h-3 w-3 mr-1" />
                {{ enablingPlugin === plugin.id ? "Enabling..." : "Enable" }}
              </Button>

              <template v-else>
                <Button size="sm" @click="navigateToSettings(plugin.id)">
                  <Settings class="h-3 w-3 mr-1" />
                  Configure
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="disablingPlugin === plugin.id"
                  @click="disablePlugin(plugin.id)"
                >
                  <Power class="h-3 w-3 mr-1" />
                  {{ disablingPlugin === plugin.id ? "Disabling..." : "Disable" }}
                </Button>
              </template>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Package,
  CheckCircle,
  MessageSquare,
  Cpu,
  RefreshCcw,
  Settings,
  Plug,
  Power,
  Search,
  Globe,
  FileText,
  Zap,
  Database,
} from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useToast } from "@/composables/useToast";

// Reactive state
const loading = ref(true);
const searchQuery = ref("");
const selectedCategory = ref("all");
const enablingPlugin = ref<string | null>(null);
const disablingPlugin = ref<string | null>(null);

// Use app store for plugins
const appStore = useAppStore();

// Router
const router = useRouter();

// Get available (non-enabled) plugins for marketplace
const availablePlugins = computed(() => appStore.availablePlugins);

// Stats computed from all plugins (including enabled ones for stats display)
const stats = computed(() => {
  const allPlugins = appStore.plugins;
  return {
    total: allPlugins.length,
    enabled: appStore.enabledPlugins.length,
    chatConnectors: allPlugins.filter((p) => p.type.includes("channel")).length,
    mcpConnectors: allPlugins.filter((p) => p.type.includes("mcp-connector")).length,
  };
});

// Categories
const categories = [
  { id: "all", name: "All Plugins", icon: Globe },
  { id: "channel", name: "Channels", icon: MessageSquare },
  { id: "mcp-connector", name: "MCP Connectors", icon: Cpu },
  { id: "document_importer", name: "Document Importers", icon: FileText },
  { id: "retriever", name: "Retrievers", icon: Database },
  { id: "playbook", name: "Playbooks", icon: Zap },
];

// Computed filtered plugins (only show available/non-enabled plugins)
const filteredPlugins = computed(() => {
  let filtered = availablePlugins.value || [];

  // Filter by category
  if (selectedCategory.value !== "all") {
    filtered = filtered.filter((p) => p.type.includes(selectedCategory.value));
  }

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        (p.id && p.id.toLowerCase().includes(query)) ||
        (p.name && p.name.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)),
    );
  }

  return filtered;
});

const pluginTypes = {
  channel: {
    label: "Channel",
    icon: MessageSquare,
    bg: "bg-blue-600",
  },
  "mcp-connector": {
    label: "MCP Connector",
    icon: Cpu,
    bg: "bg-purple-600",
  },
  document_importer: {
    label: "Document Importer",
    icon: FileText,
    bg: "bg-green-600",
  },
  retriever: {
    label: "Retriever",
    icon: Database,
    bg: "bg-orange-600",
  },
  playbook: {
    label: "Playbook",
    icon: Zap,
    bg: "bg-pink-600",
  },
};

const formatPluginType = (type: string) => {
  return pluginTypes[type as keyof typeof pluginTypes].label;
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

const fetchPlugins = async () => {
  loading.value = true;
  try {
    await appStore.fetchPlugins();
    console.log("🔍 [DEBUG] Fetched plugins:", appStore.plugins);
  } catch (error) {
    console.error("Failed to fetch plugins:", error);
  } finally {
    loading.value = false;
  }
};

const refreshPlugins = () => {
  fetchPlugins();
};

const enablePlugin = async (pluginId: string) => {
  console.log("🔍 [DEBUG] Enabling plugin with ID:", pluginId);
  enablingPlugin.value = pluginId;
  const { toast } = useToast();

  try {
    await appStore.enablePlugin(pluginId);

    // Show success toast
    toast.success(`Plugin ${pluginId.replace("hay-plugin-", "")} enabled successfully`);

    // Navigate to settings if plugin has configuration
    const plugin = appStore.getPluginById(pluginId);
    if (plugin?.hasConfiguration) {
      navigateToSettings(pluginId);
    }
  } catch (error: unknown) {
    console.error("Failed to enable plugin:", error);

    // Show error toast with details
    // TRPCError messages are in error.message for client errors
    const errorMessage = error?.message || error?.data?.message || "Failed to enable plugin";

    // Clean up the plugin name in the error message for better readability
    const cleanMessage = errorMessage.replace(/hay-plugin-/g, "");
    toast.error(cleanMessage, undefined, 10000); // Show error for 10 seconds
  } finally {
    enablingPlugin.value = null;
  }
};

const disablePlugin = async (pluginId: string) => {
  disablingPlugin.value = pluginId;
  const { toast } = useToast();

  try {
    await appStore.disablePlugin(pluginId);

    // Show success toast
    toast.success(`Plugin ${pluginId.replace("hay-plugin-", "")} disabled successfully`);
  } catch (error: unknown) {
    console.error("Failed to disable plugin:", error);

    // Show error toast with details
    const errorMessage = error?.message || error?.data?.message || "Failed to disable plugin";
    const cleanMessage = errorMessage.replace(/hay-plugin-/g, "");
    toast.error(cleanMessage, undefined, 10000); // Show error for 10 seconds
  } finally {
    disablingPlugin.value = null;
  }
};

const navigateToSettings = (pluginId: string) => {
  router.push(`/integrations/plugins/${pluginId}`);
};

// Lifecycle
onMounted(() => {
  fetchPlugins();
});

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: "Plugin Marketplace - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Discover and install plugins to extend your platform capabilities",
    },
  ],
});
</script>
