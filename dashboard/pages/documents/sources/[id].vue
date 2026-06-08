<template>
  <Page :title="source?.displayName || 'Document Source'" :description="source?.sourceType ?? ''">
    <template #header>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="ghost" @click="router.push('/documents/sources')">
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          v-if="source"
          variant="outline"
          :loading="syncing || source.lastSyncStatus === 'running'"
          @click="syncNow(false)"
        >
          <RefreshCw v-if="!syncing && source.lastSyncStatus !== 'running'" class="h-4 w-4 mr-2" />
          Sync now
        </Button>
        <Button v-if="source" variant="outline" :loading="sweeping" @click="syncNow(true)">
          <RotateCw v-if="!sweeping" class="h-4 w-4 mr-2" />
          Force full sweep
        </Button>
        <Button
          v-if="source"
          variant="outline"
          class="text-destructive hover:text-destructive"
          @click="showDisconnectDialog = true"
        >
          <Trash2 class="h-4 w-4 mr-2" />
          Disconnect
        </Button>
      </div>
    </template>

    <!-- Loading state -->
    <div v-if="loading && !source" class="text-center py-12">
      <Loading label="Loading source..." />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-12 w-12 text-red-500 mb-4" />
      <p class="text-lg font-medium text-foreground">Failed to load source</p>
      <p class="text-sm text-neutral-muted mt-1">{{ error }}</p>
      <div class="flex gap-3 mt-6">
        <Button variant="outline" @click="router.push('/documents/sources')">Back</Button>
        <Button @click="loadSource">Try again</Button>
      </div>
    </div>

    <template v-else-if="source">
      <!-- Status overview card -->
      <Card>
        <CardHeader>
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <div
                class="h-12 w-12 rounded-md bg-background-tertiary flex items-center justify-center overflow-hidden"
              >
                <img
                  v-if="!thumbnailFailed"
                  :src="thumbnailUrl"
                  :alt="source.pluginId"
                  class="h-12 w-12 object-cover"
                  @error="thumbnailFailed = true"
                />
                <component
                  :is="getSourceIcon(source.sourceType)"
                  v-else
                  class="h-6 w-6 text-foreground"
                />
              </div>
              <div>
                <CardTitle>{{ source.displayName }}</CardTitle>
                <p class="text-sm text-neutral-muted mt-1">
                  {{ source.pluginId }} · {{ source.sourceType }}
                </p>
              </div>
            </div>
            <div
              :class="[
                'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
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
          </div>
        </CardHeader>
        <CardContent>
          <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <dt class="text-xs text-neutral-muted">Last synced</dt>
              <dd class="text-sm mt-1">
                {{ source.lastSyncedAt ? formatRelativeTime(source.lastSyncedAt) : "Never" }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-muted">Documents</dt>
              <dd class="text-sm mt-1">{{ documentCount }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-muted">Last full sweep</dt>
              <dd class="text-sm mt-1">
                {{ source.lastFullSweepAt ? formatRelativeTime(source.lastFullSweepAt) : "Never" }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-muted">Created</dt>
              <dd class="text-sm mt-1">{{ formatDateTime(source.createdAt) }}</dd>
            </div>
          </dl>
          <p
            v-if="source.lastSyncStatus === 'error' && source.lastSyncError"
            class="mt-4 text-sm text-red-600 dark:text-red-400"
          >
            {{ source.lastSyncError }}
          </p>
        </CardContent>
      </Card>

      <!-- Live sync progress -->
      <Card v-if="isSyncing" class="border-primary/40">
        <CardHeader class="pb-3">
          <CardTitle class="flex items-center gap-2 text-base">
            <Loader2 class="h-4 w-4 animate-spin text-primary" />
            {{ progressPhaseLabel }}
          </CardTitle>
          <CardDescription>{{ progressSummary }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <!-- Determinate bar when we know the total, otherwise an indeterminate sweep -->
          <div class="h-2 rounded bg-background-tertiary overflow-hidden">
            <div
              v-if="progressPercent !== null"
              class="h-full bg-primary transition-all duration-500"
              :style="{ width: `${progressPercent}%` }"
            />
            <div v-else class="h-full w-1/3 bg-primary/60 animate-pulse" />
          </div>

          <p
            v-if="activeProgress && (activeProgress.currentTitle || activeProgress.currentUrl)"
            class="text-xs text-neutral-muted truncate max-w-48"
            :title="activeProgress.currentUrl || ''"
          >
            Now importing: {{ activeProgress.currentTitle || activeProgress.currentUrl }}
          </p>

          <div v-if="activeProgress" class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span class="text-neutral-muted">Discovered {{ activeProgress.discovered }}</span>
            <span class="text-green-600 dark:text-green-400"
              >+{{ activeProgress.created }} new</span
            >
            <span class="text-neutral-muted">{{ activeProgress.updated }} updated</span>
            <span v-if="activeProgress.skipped > 0" class="text-neutral-muted">
              {{ activeProgress.skipped }} unchanged
            </span>
            <span v-if="activeProgress.failed > 0" class="text-red-600 dark:text-red-400">
              {{ activeProgress.failed }} failed
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- Settings card -->
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Update how this source behaves.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <Label for="displayName">Display name</Label>
            <Input id="displayName" v-model="form.displayName" class="mt-1" />
          </div>

          <div class="flex items-center justify-between">
            <div>
              <Label class="block">Enabled</Label>
              <p class="text-xs text-neutral-muted mt-0.5">
                Disabled sources won't be synced automatically.
              </p>
            </div>
            <Switch v-model="form.enabled" />
          </div>

          <div>
            <Label for="syncInterval">Sync frequency</Label>
            <Input
              id="syncInterval"
              v-model="syncIntervalChoice"
              type="select"
              :options="syncIntervalOptions"
              class="mt-1"
            />
          </div>

          <div class="flex justify-end">
            <Button :loading="saving" :disabled="!isDirty" @click="saveSettings">Save</Button>
          </div>
        </CardContent>
      </Card>

      <!-- Documents linked -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Documents</CardTitle>
              <CardDescription>
                {{ documentCount }} documents imported from this source.
              </CardDescription>
            </div>
            <NuxtLink :to="`/documents?documentSourceId=${source.id}`">
              <Button variant="outline" size="sm">
                View in documents
                <ArrowRight class="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </NuxtLink>
          </div>
        </CardHeader>
      </Card>

      <!-- Sync history -->
      <Card>
        <CardHeader>
          <CardTitle>Recent sync jobs</CardTitle>
          <CardDescription>The last 10 sync runs for this source.</CardDescription>
        </CardHeader>
        <CardContent>
          <div v-if="historyLoading && history.length === 0" class="space-y-3">
            <div
              v-for="i in 3"
              :key="i"
              class="animate-pulse h-12 bg-background-tertiary rounded"
            />
          </div>
          <div v-else-if="history.length === 0" class="text-sm text-neutral-muted py-8 text-center">
            No sync runs yet. Trigger one with "Sync now".
          </div>
          <Table v-else>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="job in history" :key="job.id">
                <TableCell>
                  <div
                    :class="[
                      'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap',
                      jobStatusPillClass(job.status),
                    ]"
                  >
                    <Loader2
                      v-if="
                        ['running', 'in_progress', 'processing', 'queued', 'pending'].includes(
                          job.status,
                        )
                      "
                      class="h-3 w-3 mr-1.5 animate-spin"
                    />
                    <div
                      v-else
                      :class="['w-2 h-2 rounded-full mr-1.5', jobStatusDotClass(job.status)]"
                    />
                    {{ job.status }}
                  </div>
                </TableCell>
                <TableCell class="text-sm">{{ job.title || "Sync run" }}</TableCell>
                <TableCell class="text-sm whitespace-nowrap">
                  {{ formatDateTime(job.createdAt) }}
                </TableCell>
                <TableCell class="text-sm whitespace-nowrap">
                  {{ formatRelativeTime(job.updatedAt) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>

    <!-- Disconnect dialog -->
    <Dialog v-model:open="showDisconnectDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect source</DialogTitle>
          <DialogDescription>
            Choose what happens to the documents imported from
            <span class="font-medium">{{ source?.displayName }}</span
            >.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3 mt-2">
          <button
            type="button"
            :class="[
              'w-full text-left p-4 rounded-lg border transition-colors',
              disconnectMode === 'keep'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-background-tertiary',
            ]"
            @click="disconnectMode = 'keep'"
          >
            <div class="font-medium text-sm">Keep documents</div>
            <p class="text-xs text-neutral-muted mt-1">
              Documents remain in your knowledge base but detach from this source.
            </p>
          </button>
          <button
            type="button"
            :class="[
              'w-full text-left p-4 rounded-lg border transition-colors',
              disconnectMode === 'delete'
                ? 'border-destructive bg-destructive/5'
                : 'border-border hover:bg-background-tertiary',
            ]"
            @click="disconnectMode = 'delete'"
          >
            <div class="font-medium text-sm text-destructive">Delete documents</div>
            <p class="text-xs text-neutral-muted mt-1">
              Permanently remove every document (and its embeddings) imported from this source. This
              cannot be undone.
            </p>
          </button>
        </div>

        <DialogFooter class="mt-4">
          <Button variant="outline" @click="showDisconnectDialog = false">Cancel</Button>
          <Button
            :variant="disconnectMode === 'delete' ? 'destructive' : 'default'"
            :loading="disconnecting"
            @click="disconnect"
          >
            {{ disconnectMode === "delete" ? "Delete & disconnect" : "Disconnect" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  RotateCw,
  Trash2,
  AlertCircle,
  Loader2,
  Database,
  Cloud,
  BookOpen,
  FolderTree,
} from "lucide-vue-next";

interface DocumentSource {
  id: string;
  pluginId: string;
  pluginInstanceId: string | null;
  sourceType: string;
  displayName: string;
  enabled: boolean;
  syncIntervalMs: number | null;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: "idle" | "running" | "success" | "error" | "partial" | string;
  lastSyncError: string | null;
  lastSyncStats: Record<string, unknown> | null;
  lastFullSweepAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  documentsCount?: number;
}

interface SyncJob {
  id: string;
  status: string;
  title: string | null;
  description: string | null;
  data: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

const sourceId = computed(() => route.params.id as string);

const source = ref<DocumentSource | null>(null);
const history = ref<SyncJob[]>([]);
const loading = ref(false);
const thumbnailFailed = ref(false);

const { getApiUrl } = useDomain();
const thumbnailUrl = computed(() => {
  const pluginId = source.value?.pluginId;
  return pluginId ? `${getApiUrl()}/plugins/thumbnails/${encodeURIComponent(pluginId)}` : "";
});
const historyLoading = ref(false);
const error = ref<string | null>(null);
const syncing = ref(false);
const sweeping = ref(false);
const saving = ref(false);
const disconnecting = ref(false);
const showDisconnectDialog = ref(false);
const disconnectMode = ref<"keep" | "delete">("keep");

const form = ref({
  displayName: "",
  enabled: true,
});

// Discrete options match the connect flow (PluginSpacePicker) — no more
// open-ended numeric input. Each value maps to milliseconds; null = manual.
const syncIntervalOptions = [
  { label: "Manual only", value: "manual" },
  { label: "Every hour", value: "1h" },
  { label: "Every day", value: "1d" },
];
const SYNC_INTERVAL_MS: Record<string, number | null> = {
  manual: null,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};
const msToChoice = (ms: number | null | undefined): string => {
  if (!ms || ms <= 0) return "manual";
  if (ms >= SYNC_INTERVAL_MS["1d"]!) return "1d";
  if (ms >= SYNC_INTERVAL_MS["1h"]!) return "1h";
  return "manual";
};
const syncIntervalChoice = ref<string>("manual");

let pollTimer: ReturnType<typeof setInterval> | null = null;

// Live, per-run progress the sync engine streams onto the job's data.progress.
interface SyncProgressView {
  phase: "discovering" | "importing" | "reconciling";
  total?: number;
  discovered: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  currentTitle?: string;
  currentUrl?: string;
  updatedAt?: string;
}

// Job statuses that mean "a sync is happening right now" (queue lifecycle +
// the source's own status). Used to decide when to poll and show progress.
const ACTIVE_JOB_STATUSES = [
  "pending",
  "queued",
  "processing",
  "retrying",
  "running",
  "in_progress",
];

const activeJob = computed(
  () => history.value.find((j) => ACTIVE_JOB_STATUSES.includes(j.status)) ?? null,
);

const activeProgress = computed<SyncProgressView | null>(() => {
  const data = activeJob.value?.data as { progress?: SyncProgressView } | null;
  return data?.progress ?? null;
});

const isSyncing = computed(() => {
  if (activeJob.value) return true;
  const status = source.value?.lastSyncStatus;
  return status === "running" || status === "partial";
});

const progressPercent = computed<number | null>(() => {
  const p = activeProgress.value;
  if (!p || !p.total || p.total <= 0) return null;
  return Math.min(100, Math.round((p.processed / p.total) * 100));
});

const progressPhaseLabel = computed(() => {
  switch (activeProgress.value?.phase) {
    case "discovering":
      return "Discovering pages…";
    case "reconciling":
      return "Finishing up…";
    default:
      return "Importing pages…";
  }
});

const progressSummary = computed(() => {
  const p = activeProgress.value;
  if (!p) return "Starting…";
  if (p.total && p.total > 0) return `${p.processed} of ${p.total} pages`;
  return `${p.processed} imported · ${p.discovered} discovered`;
});

const needsPolling = computed(() => isSyncing.value);

const documentCount = computed(() => {
  // Authoritative count from the server (set by documentSources.get).
  if (typeof source.value?.documentsCount === "number") {
    return source.value.documentsCount;
  }
  // Fallback: best-effort approximation from the latest sync stats if the
  // server hasn't filled in documentsCount yet (e.g. older cached payload).
  const stats = source.value?.lastSyncStats as Record<string, unknown> | null;
  if (stats) {
    const sum =
      (Number(stats.created) || 0) + (Number(stats.updated) || 0) + (Number(stats.skipped) || 0);
    if (sum > 0) return sum;
  }
  return 0;
});

const isDirty = computed(() => {
  if (!source.value) return false;
  const currentIntervalMs = SYNC_INTERVAL_MS[syncIntervalChoice.value] ?? null;
  return (
    form.value.displayName !== source.value.displayName ||
    form.value.enabled !== source.value.enabled ||
    currentIntervalMs !== source.value.syncIntervalMs
  );
});

const applyFormFromSource = (s: DocumentSource) => {
  form.value.displayName = s.displayName;
  form.value.enabled = s.enabled;
  syncIntervalChoice.value = msToChoice(s.syncIntervalMs);
};

const loadSource = async () => {
  loading.value = true;
  error.value = null;
  try {
    const result = (await HayApi.documentSources.get.query({
      id: sourceId.value,
    })) as DocumentSource;
    source.value = result;
    applyFormFromSource(result);
  } catch (err) {
    console.error("Failed to load source:", err);
    error.value = (err as Error).message || "Unable to load source";
  } finally {
    loading.value = false;
  }
};

const refreshSource = async () => {
  try {
    const result = (await HayApi.documentSources.get.query({
      id: sourceId.value,
    })) as DocumentSource;
    source.value = result;
  } catch (err) {
    console.error("Failed to refresh source:", err);
  }
};

const loadHistory = async () => {
  historyLoading.value = true;
  try {
    const result = (await HayApi.documentSources.getSyncHistory.query({
      id: sourceId.value,
      limit: 10,
    })) as SyncJob[];
    history.value = result;
  } catch (err) {
    console.error("Failed to load sync history:", err);
  } finally {
    historyLoading.value = false;
  }
};

const syncNow = async (forceFullSweep: boolean) => {
  if (!source.value) return;
  if (forceFullSweep) sweeping.value = true;
  else syncing.value = true;
  try {
    await HayApi.documentSources.syncNow.mutate({
      id: source.value.id,
      forceFullSweep,
    });
    toast.success(forceFullSweep ? "Full sweep started" : "Sync started");
    if (source.value) source.value.lastSyncStatus = "running";
    await Promise.all([refreshSource(), loadHistory()]);
  } catch (err) {
    console.error("Failed to start sync:", err);
    toast.error("Failed to start sync");
  } finally {
    syncing.value = false;
    sweeping.value = false;
  }
};

const saveSettings = async () => {
  if (!source.value) return;
  saving.value = true;
  try {
    const syncIntervalMs = SYNC_INTERVAL_MS[syncIntervalChoice.value] ?? null;

    const updated = (await HayApi.documentSources.update.mutate({
      id: source.value.id,
      patch: {
        displayName: form.value.displayName,
        enabled: form.value.enabled,
        syncIntervalMs,
      },
    })) as DocumentSource;

    source.value = updated;
    applyFormFromSource(updated);
    toast.success("Settings saved");
  } catch (err) {
    console.error("Failed to save settings:", err);
    toast.error("Failed to save settings");
  } finally {
    saving.value = false;
  }
};

const disconnect = async () => {
  if (!source.value) return;
  disconnecting.value = true;
  try {
    await HayApi.documentSources.delete.mutate({
      id: source.value.id,
      deleteDocuments: disconnectMode.value === "delete",
    });
    toast.success(
      disconnectMode.value === "delete"
        ? "Source disconnected and documents removed"
        : "Source disconnected",
    );
    showDisconnectDialog.value = false;
    router.push("/documents/sources");
  } catch (err) {
    console.error("Failed to disconnect source:", err);
    toast.error("Failed to disconnect source");
  } finally {
    disconnecting.value = false;
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

const jobStatusPillClass = (status: string) => {
  switch (status) {
    case "completed":
    case "success":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "failed":
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "running":
    case "in_progress":
    case "processing":
    case "queued":
    case "pending":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "partial":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300";
  }
};

const jobStatusDotClass = (status: string) => {
  switch (status) {
    case "completed":
    case "success":
      return "bg-green-600";
    case "failed":
    case "error":
      return "bg-red-600";
    case "partial":
      return "bg-yellow-600";
    default:
      return "bg-gray-500";
  }
};

const getSourceIcon = (sourceType: string) => {
  const t = sourceType?.toLowerCase() ?? "";
  if (t.includes("confluence") || t.includes("wiki") || t.includes("notion")) return BookOpen;
  if (t.includes("drive") || t.includes("gdrive") || t.includes("doc")) return FolderTree;
  if (t.includes("cloud") || t.includes("s3") || t.includes("blob")) return Cloud;
  return Database;
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
      Promise.all([refreshSource(), loadHistory()]);
    } else {
      stopPolling();
    }
  }, 2000);
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
  await Promise.all([loadSource(), loadHistory()]);
  if (needsPolling.value) startPolling();
});

onUnmounted(() => {
  stopPolling();
});

useHead({
  title: "Document Source",
  meta: [{ name: "description", content: "Manage document source settings" }],
});
</script>
