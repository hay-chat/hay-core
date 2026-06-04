<template>
  <Page
    title="Document Sources"
    description="External knowledge sources that sync documents into Hay."
  >
    <template #header>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :loading="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <NuxtLink to="/documents/import">
          <Button>
            <Plus class="mr-2 h-4 w-4" />
            Connect a source
          </Button>
        </NuxtLink>
      </div>
    </template>

    <!-- Loading skeleton -->
    <div v-if="loading && sources.length === 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="i in 4" :key="i" class="animate-pulse">
        <div class="bg-background-tertiary rounded-lg p-6 space-y-3">
          <div class="h-5 bg-background-tertiary-foreground/20 rounded w-1/2" />
          <div class="h-3 bg-background-tertiary-foreground/20 rounded w-1/3" />
          <div class="h-8 bg-background-tertiary-foreground/20 rounded w-2/3 mt-4" />
        </div>
      </div>
    </div>

    <!-- Sources grid -->
    <div
      v-else-if="sources.length > 0"
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <Card
        v-for="source in sources"
        :key="source.id"
        class="flex flex-col min-w-0 overflow-hidden"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="h-10 w-10 rounded-md bg-background-tertiary flex items-center justify-center flex-shrink-0 overflow-hidden"
              >
                <img
                  v-if="thumbnailFailed[source.id] !== true"
                  :src="thumbnailUrl(source.pluginId)"
                  :alt="source.pluginId"
                  class="h-10 w-10 object-cover"
                  @error="thumbnailFailed[source.id] = true"
                />
                <component
                  :is="getSourceIcon(source.sourceType)"
                  v-else
                  class="h-5 w-5 text-foreground"
                />
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-base font-semibold truncate" :title="source.displayName">
                  {{ source.displayName }}
                </h3>
                <p class="text-xs text-neutral-muted mt-0.5 truncate">
                  {{ source.sourceType }}
                </p>
              </div>
            </div>
            <span
              v-if="!source.enabled"
              class="text-[10px] uppercase tracking-wide bg-background-tertiary text-neutral-muted px-2 py-0.5 rounded"
            >
              Disabled
            </span>
          </div>
        </CardHeader>

        <CardContent class="flex-1 space-y-3">
          <!-- Status pill -->
          <div class="flex items-center justify-between">
            <div
              :class="[
                'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                statusPillClass(source.lastSyncStatus),
              ]"
            >
              <Loader2
                v-if="source.lastSyncStatus === 'running'"
                class="h-3 w-3 mr-1.5 animate-spin"
              />
              <div
                v-else
                :class="['w-2 h-2 rounded-full mr-1.5', statusDotClass(source.lastSyncStatus)]"
              />
              {{ statusLabel(source.lastSyncStatus) }}
            </div>
            <span class="text-xs text-neutral-muted">
              {{ source.lastSyncedAt ? formatRelativeTime(source.lastSyncedAt) : "never synced" }}
            </span>
          </div>

          <!-- Stats -->
          <div class="flex items-center gap-4 text-xs text-neutral-muted pt-1">
            <div class="flex items-center gap-1">
              <FileText class="h-3.5 w-3.5" />
              <span>{{ documentCount(source) }} documents</span>
            </div>
            <div
              v-if="source.pluginId && !source.pluginId.startsWith('core:')"
              class="flex items-center gap-1 truncate"
            >
              <Puzzle class="h-3.5 w-3.5" />
              <span class="truncate" :title="source.pluginId">{{ source.pluginId }}</span>
            </div>
          </div>

          <!-- Last sync error -->
          <p
            v-if="source.lastSyncStatus === 'error' && source.lastSyncError"
            class="text-xs text-red-600 dark:text-red-400 truncate"
            :title="source.lastSyncError"
          >
            {{ source.lastSyncError }}
          </p>
        </CardContent>

        <CardFooter class="pt-3 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            :loading="syncingIds.has(source.id) || source.lastSyncStatus === 'running'"
            @click="syncNow(source)"
          >
            <RefreshCw
              v-if="!syncingIds.has(source.id) && source.lastSyncStatus !== 'running'"
              class="mr-2 h-3.5 w-3.5"
            />
            Sync now
          </Button>
          <NuxtLink :to="`/documents/sources/${source.id}`">
            <Button variant="ghost" size="sm">
              Open
              <ArrowRight class="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </NuxtLink>
        </CardFooter>
      </Card>
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="!loading"
      title="No external sources connected"
      description="No external sources connected. Connect Confluence, Notion, or Google Docs from the Import page."
      illustration="/bale/document.svg"
      action="Go to Import"
      @click="router.push('/documents/import')"
    />
  </Page>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import {
  RefreshCw,
  Plus,
  FileText,
  Puzzle,
  ArrowRight,
  Loader2,
  Database,
  Cloud,
  BookOpen,
  FolderTree,
  Globe,
} from "lucide-vue-next";

interface DocumentSource {
  id: string;
  pluginId: string;
  pluginInstanceId: string | null;
  sourceType: string;
  displayName: string;
  enabled: boolean;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: "idle" | "running" | "success" | "error" | "partial" | string;
  lastSyncError: string | null;
  lastSyncStats: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const router = useRouter();
const toast = useToast();

const loading = ref(false);
const sources = ref<DocumentSource[]>([]);
const syncingIds = ref<Set<string>>(new Set());
const thumbnailFailed = reactive<Record<string, boolean>>({});

const { getApiUrl } = useDomain();
const thumbnailUrl = (pluginId: string) =>
  `${getApiUrl()}/plugins/thumbnails/${encodeURIComponent(pluginId)}`;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const needsPolling = computed(() =>
  sources.value.some((s) => s.lastSyncStatus === "running" || s.lastSyncStatus === "partial"),
);

const refreshData = async (showLoader = true) => {
  if (showLoader) loading.value = true;
  try {
    const result = (await HayApi.documentSources.list.query()) as DocumentSource[];
    sources.value = result;
  } catch (error) {
    console.error("Failed to fetch document sources:", error);
    toast.error("Failed to load document sources");
  } finally {
    loading.value = false;
  }
};

const syncNow = async (source: DocumentSource) => {
  if (syncingIds.value.has(source.id)) return;
  syncingIds.value.add(source.id);
  try {
    await HayApi.documentSources.syncNow.mutate({ id: source.id });
    toast.success(`Sync started for ${source.displayName}`);
    // Optimistically flip status to running so polling kicks in
    source.lastSyncStatus = "running";
    await refreshData(false);
  } catch (error) {
    console.error("Failed to start sync:", error);
    toast.error("Failed to start sync");
  } finally {
    syncingIds.value.delete(source.id);
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "running":
      return "Syncing";
    case "success":
      return "Healthy";
    case "error":
      return "Error";
    case "partial":
      return "Partial";
    case "idle":
    default:
      return "Idle";
  }
};

const statusPillClass = (status: string) => {
  switch (status) {
    case "running":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "success":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "partial":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "idle":
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300";
  }
};

const statusDotClass = (status: string) => {
  switch (status) {
    case "success":
      return "bg-green-600";
    case "error":
      return "bg-red-600";
    case "partial":
      return "bg-yellow-600";
    case "idle":
    default:
      return "bg-gray-500";
  }
};

const getSourceIcon = (sourceType: string) => {
  const t = sourceType?.toLowerCase() ?? "";
  if (t.includes("website") || t.includes("web")) return Globe;
  if (t.includes("confluence") || t.includes("wiki") || t.includes("notion")) return BookOpen;
  if (t.includes("drive") || t.includes("gdrive") || t.includes("doc")) return FolderTree;
  if (t.includes("cloud") || t.includes("s3") || t.includes("blob")) return Cloud;
  return Database;
};

const documentCount = (source: DocumentSource): number => {
  const stats = source.lastSyncStats as Record<string, unknown> | null;
  if (!stats) return 0;
  const candidates = ["documentsTotal", "documentsCount", "totalDocuments", "imported", "ingested"];
  for (const key of candidates) {
    if (typeof stats[key] === "number") return stats[key] as number;
  }
  return 0;
};

const formatRelativeTime = (input: Date | string | null): string => {
  if (!input) return "never";
  const date = typeof input === "string" ? new Date(input) : input;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 4) return `${week}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
};

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (needsPolling.value) {
      refreshData(false);
    } else {
      stopPolling();
    }
  }, 5000);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

watch(needsPolling, (shouldPoll) => {
  if (shouldPoll) startPolling();
  else stopPolling();
});

onMounted(async () => {
  await refreshData();
  if (needsPolling.value) startPolling();
});

onUnmounted(() => {
  stopPolling();
});

useHead({
  title: "Document Sources",
  meta: [{ name: "description", content: "Manage external document sources" }],
});
</script>
