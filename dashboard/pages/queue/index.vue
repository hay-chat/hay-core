<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Job Queue</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Monitor and manage background jobs and processing tasks.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Pending</p>
              <p class="text-2xl font-bold text-yellow-600">
                {{ stats.pending || 0 }}
              </p>
            </div>
            <Clock class="h-8 w-8 text-yellow-600 opacity-50" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Processing</p>
              <p class="text-2xl font-bold text-blue-600">
                {{ stats.processing || 0 }}
              </p>
            </div>
            <Activity class="h-8 w-8 text-blue-600 opacity-50" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Completed</p>
              <p class="text-2xl font-bold text-green-600">
                {{ stats.completed || 0 }}
              </p>
            </div>
            <CheckCircle class="h-8 w-8 text-green-600 opacity-50" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Failed</p>
              <p class="text-2xl font-bold text-red-600">
                {{ stats.failed || 0 }}
              </p>
            </div>
            <XCircle class="h-8 w-8 text-red-600 opacity-50" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Filters -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search jobs by type or ID..."
            class="pl-10"
            @input="handleSearch"
          />
        </div>
      </div>
      <div class="flex gap-2">
        <select
          v-model="statusFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="retrying">Retrying</option>
        </select>
        <select
          v-model="typeFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">All Types</option>
          <option value="document_upload">Document Upload</option>
          <option value="document_processing">Document Processing</option>
          <option value="email">Email</option>
          <option value="export">Export</option>
          <option value="import">Import</option>
        </select>
      </div>
    </div>

    <!-- Jobs Table -->
    <Card>
      <CardContent class="p-0">
        <div v-if="loading && !jobs.length" class="p-8 text-center">
          <Loader2 class="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p class="mt-2 text-sm text-muted-foreground">Loading jobs...</p>
        </div>

        <div v-else-if="!jobs.length" class="p-8 text-center">
          <Inbox class="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 class="mt-2 text-sm font-semibold text-foreground">No jobs found</h3>
          <p class="mt-1 text-sm text-muted-foreground">There are no jobs matching your filters.</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full">
            <thead class="border-b bg-background-secondary">
              <tr>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Job ID
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Type
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Priority
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Progress
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Created
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Duration
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr
                v-for="job in jobs"
                :key="job.id"
                class="hover:bg-background-secondary transition-colors"
              >
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center">
                    <code class="text-xs bg-background-tertiary px-2 py-1 rounded">{{
                      job.id.slice(0, 8)
                    }}</code>
                  </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                  {{ formatJobType(job.type) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <Badge :variant="getStatusVariant(job.status)">
                    {{ job.status }}
                  </Badge>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <Badge :variant="getPriorityVariant(job.priority)">
                    {{ getPriorityLabel(job.priority) }}
                  </Badge>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div v-if="job.status === 'processing'" class="w-24">
                    <div class="flex items-center">
                      <div class="flex-1 bg-background-tertiary rounded-full h-2 mr-2">
                        <div
                          class="bg-primary rounded-full h-2 transition-all duration-300"
                          :style="{ width: `${job.progress || 0}%` }"
                        />
                      </div>
                      <span class="text-xs text-muted-foreground">{{ job.progress || 0 }}%</span>
                    </div>
                  </div>
                  <span v-else class="text-sm text-muted-foreground">-</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {{ formatDate(job.created_at) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                  {{ formatDuration((job as any).duration) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  <div class="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="View Details"
                      @click="viewJobDetails(job)"
                    >
                      <Eye class="h-4 w-4" />
                    </Button>
                    <Button
                      v-if="job.status === 'failed' && job.attempts && job.max_attempts && job.attempts < job.max_attempts"
                      variant="ghost"
                      size="sm"
                      title="Retry Job"
                      @click="retryJob(job)"
                    >
                      <RotateCw class="h-4 w-4" />
                    </Button>
                    <Button
                      v-if="['pending', 'queued', 'processing'].includes(job.status)"
                      variant="ghost"
                      size="sm"
                      title="Cancel Job"
                      @click="cancelJob(job)"
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="px-6 py-4 border-t">
          <div class="flex items-center justify-between">
            <p class="text-sm text-muted-foreground">
              Showing {{ (currentPage - 1) * pageSize + 1 }} to
              {{ Math.min(currentPage * pageSize, totalJobs) }} of {{ totalJobs }} jobs
            </p>
            <div class="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === 1"
                @click="goToPage(currentPage - 1)"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === totalPages"
                @click="goToPage(currentPage + 1)"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Job Details Modal -->
    <Dialog v-model:open="showDetailsModal">
      <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job Details</DialogTitle>
        </DialogHeader>
        <div v-if="selectedJob" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-sm font-medium text-muted-foreground">ID</p>
              <code class="text-xs bg-background-tertiary px-2 py-1 rounded">{{
                selectedJob.id
              }}</code>
            </div>
            <div>
              <p class="text-sm font-medium text-muted-foreground">Type</p>
              <p class="text-sm">
                {{ formatJobType(selectedJob.type) }}
              </p>
            </div>
            <div>
              <p class="text-sm font-medium text-muted-foreground">Status</p>
              <Badge :variant="getStatusVariant(selectedJob.status)">
                {{ selectedJob.status }}
              </Badge>
            </div>
            <div>
              <p class="text-sm font-medium text-muted-foreground">Priority</p>
              <Badge :variant="getPriorityVariant(selectedJob.priority)">
                {{ getPriorityLabel(selectedJob.priority) }}
              </Badge>
            </div>
            <div>
              <p class="text-sm font-medium text-muted-foreground">Attempts</p>
              <p class="text-sm">{{ selectedJob.attempts }} / {{ selectedJob.max_attempts }}</p>
            </div>
            <div>
              <p class="text-sm font-medium text-muted-foreground">Created</p>
              <p class="text-sm">
                {{ formatDate(selectedJob.created_at, true) }}
              </p>
            </div>
            <div v-if="selectedJob.started_at">
              <p class="text-sm font-medium text-muted-foreground">Started</p>
              <p class="text-sm">
                {{ formatDate(selectedJob.started_at, true) }}
              </p>
            </div>
            <div v-if="selectedJob.completed_at">
              <p class="text-sm font-medium text-muted-foreground">Completed</p>
              <p class="text-sm">
                {{ formatDate(selectedJob.completed_at, true) }}
              </p>
            </div>
          </div>

          <div v-if="selectedJob.payload" class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">Payload</p>
            <pre class="bg-background-tertiary p-3 rounded text-xs overflow-x-auto">{{
              JSON.stringify(selectedJob.payload, null, 2)
            }}</pre>
          </div>

          <div v-if="selectedJob.result" class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">Result</p>
            <pre class="bg-background-tertiary p-3 rounded text-xs overflow-x-auto">{{
              JSON.stringify(selectedJob.result, null, 2)
            }}</pre>
          </div>

          <div v-if="selectedJob.error" class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">Error</p>
            <div class="bg-destructive/10 border border-destructive/20 p-3 rounded">
              <p class="text-sm text-destructive">
                {{ selectedJob.error }}
              </p>
            </div>
          </div>

          <div v-if="(selectedJob as any).metadata?.logs" class="space-y-2">
            <p class="text-sm font-medium text-muted-foreground">Logs</p>
            <div class="bg-background-tertiary p-3 rounded max-h-48 overflow-y-auto">
              <p
                v-for="(log, index) in (selectedJob as any).metadata.logs"
                :key="index"
                class="text-xs font-mono"
              >
                {{ log }}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  CheckCircle,
  Clock,
  Eye,
  Inbox,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  X,
  XCircle,
} from "lucide-vue-next";
import { createAuthenticatedWebSocket, parseWebSocketMessage } from "@/utils/websocket";
import type { Job } from "~/types/job";

// State
const loading = ref(false);
const jobs = ref<Job[]>([]);
const totalJobs = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);
const searchQuery = ref("");
const statusFilter = ref("");
const typeFilter = ref("");
const showDetailsModal = ref(false);
const selectedJob = ref<Job | null>(null);
const stats = ref({
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
});

// Computed
const totalPages = computed(() => Math.ceil(totalJobs.value / pageSize.value));

// Methods
const fetchJobs = async () => {};

const fetchStats = async () => {};

const refreshData = async () => {
  await Promise.all([fetchJobs(), fetchStats()]);
};

const handleSearch = () => {
  currentPage.value = 1;
  fetchJobs();
};

const applyFilters = () => {
  currentPage.value = 1;
  fetchJobs();
};

const goToPage = (page: number) => {
  currentPage.value = page;
  fetchJobs();
};

const viewJobDetails = (job: Job) => {
  selectedJob.value = job;
  showDetailsModal.value = true;
};

const retryJob = async (_job: Job) => {};

const cancelJob = async (_job: Job) => {};

// Formatting helpers
const formatJobType = (type: string) => {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "secondary",
    queued: "secondary",
    processing: "default",
    completed: "default", // Changed from 'success' to 'default' since Badge doesn't have success variant
    failed: "destructive",
    cancelled: "outline",
    retrying: "secondary", // Changed from 'warning' to 'secondary' since Badge doesn't have warning variant
  };
  return variants[status] || "default";
};

const getPriorityLabel = (priority: number) => {
  const labels = ["Low", "Normal", "High", "Critical"];
  return labels[priority] || "Unknown";
};

const getPriorityVariant = (
  priority: number,
): "default" | "secondary" | "destructive" | "outline" => {
  const variants: ("default" | "secondary" | "destructive" | "outline")[] = [
    "outline",
    "default",
    "secondary",
    "destructive",
  ];
  return variants[priority] || "default";
};

const formatDate = (date: string, includeTime = false) => {
  if (!date) return "-";
  const d = new Date(date);
  if (includeTime) {
    return d.toLocaleString();
  }
  return d.toLocaleDateString();
};

const formatDuration = (duration: number | null) => {
  if (!duration) return "-";

  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

// Setup WebSocket for real-time updates
const setupWebSocket = () => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const connect = () => {
    // Try to establish WebSocket connection
    ws = createAuthenticatedWebSocket();

    if (!ws) {
      // Fall back to polling if WebSocket fails to create
      startPolling();
      return;
    }

    ws.onopen = () => {
      console.log("WebSocket connected for queue updates");
      // Stop polling if it was running
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    ws.onmessage = (event) => {
      const message = parseWebSocketMessage(event.data);
      if (message) {
        // Handle different message types for queue updates
        if (message.type === "queue_update" || message.type === "job_update") {
          fetchStats();
          if (["", "pending", "queued", "processing", "retrying"].includes(statusFilter.value)) {
            fetchJobs();
          }
        }
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected, falling back to polling");
      // Fall back to polling and try to reconnect
      startPolling();

      // Try to reconnect after 5 seconds
      if (!reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          connect();
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      ws?.close();
    };
  };

  const startPolling = () => {
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        if (!loading.value) {
          fetchStats();
          // Only refresh jobs if we're viewing active jobs
          if (["", "pending", "queued", "processing", "retrying"].includes(statusFilter.value)) {
            fetchJobs();
          }
        }
      }, 5000);
    }
  };

  // Start connection
  connect();

  // Cleanup on unmount
  onUnmounted(() => {
    ws?.close();
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });
};

// Lifecycle
onMounted(() => {
  refreshData();
  setupWebSocket();
});
</script>
