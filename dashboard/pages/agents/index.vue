<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">AI Agents</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Create and manage your AI agents to automate customer interactions.
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
        <Button @click="createAgent">
          <Plus class="mr-2 h-4 w-4" />
          Create Agent
        </Button>
      </div>
    </div>

    <!-- Search and Filter -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search agents..."
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
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="training">Training</option>
          <option value="error">Error</option>
        </select>
        <select
          v-model="typeFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">All Types</option>
          <option value="customer-support">Customer Support</option>
          <option value="sales">Sales</option>
          <option value="technical">Technical</option>
          <option value="general">General</option>
        </select>
      </div>
    </div>

    <!-- Bulk Actions -->
    <div v-if="selectedAgents.length > 0" class="bg-muted p-4 rounded-lg">
      <div class="flex items-center justify-between">
        <p class="text-sm text-foreground">
          {{ selectedAgents.length }} agent{{
            selectedAgents.length === 1 ? "" : "s"
          }}
          selected
        </p>
        <div class="flex space-x-2">
          <Button variant="outline" size="sm" @click="bulkToggleStatus">
            <Power class="mr-2 h-4 w-4" />
            Toggle Status
          </Button>
          <Button variant="outline" size="sm" @click="bulkExport">
            <Download class="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="destructive" size="sm" @click="bulkDelete">
            <Trash2 class="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>

    <!-- Agents Grid -->
    <div
      v-if="!loading && filteredAgents.length > 0"
      class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      <Card
        v-for="agent in paginatedAgents"
        :key="agent.id"
        :class="[
          'hover:shadow-md transition-shadow',
          selectedAgents.includes(agent.id) ? 'ring-2 ring-primary' : '',
        ]"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <Checkbox
                :checked="selectedAgents.includes(agent.id)"
                @update:checked="toggleAgentSelection(agent.id)"
              />
              <div
                class="h-12 w-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center"
              >
                <Bot class="h-6 w-6 text-white" />
              </div>
              <div class="flex-1">
                <CardTitle class="text-lg">{{ agent.name }}</CardTitle>
                <CardDescription class="mt-1">{{
                  agent.description
                }}</CardDescription>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                  <MoreVertical class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @click="viewAgent(agent.id)">
                  <Settings class="mr-2 h-4 w-4" />
                  Manage
                </DropdownMenuItem>
                <DropdownMenuItem @click="toggleAgentStatus(agent)">
                  <Power class="mr-2 h-4 w-4" />
                  {{ agent.status === "active" ? "Disable" : "Enable" }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  class="text-destructive"
                  @click="() => deleteAgent(agent)"
                >
                  <Trash2 class="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <!-- Status and Type -->
            <div class="flex items-center justify-between">
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  agent.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : agent.status === 'inactive'
                    ? 'bg-gray-100 text-gray-800'
                    : agent.status === 'training'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-red-100 text-red-800',
                ]"
              >
                <div
                  :class="[
                    'w-2 h-2 rounded-full mr-2',
                    agent.status === 'active'
                      ? 'bg-green-600'
                      : agent.status === 'inactive'
                      ? 'bg-gray-600'
                      : agent.status === 'training'
                      ? 'bg-blue-600'
                      : 'bg-red-600',
                  ]"
                ></div>
                {{ agent.status }}
              </div>
              <span
                class="text-xs text-muted-foreground bg-muted px-2 py-1 rounded"
              >
                {{ agent.type }}
              </span>
            </div>

            <!-- Agent Stats -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p class="text-muted-foreground">Conversations</p>
                <p class="font-medium">
                  {{ agent.conversationCount.toLocaleString() }}
                </p>
              </div>
              <div>
                <p class="text-muted-foreground">Resolution Rate</p>
                <p class="font-medium">{{ agent.resolutionRate }}%</p>
              </div>
            </div>

            <!-- Performance Metrics -->
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span>Avg Response Time</span>
                <span>{{ agent.avgResponseTime }}s</span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span>Satisfaction Score</span>
                <span class="flex items-center">
                  <Star class="h-3 w-3 text-yellow-500 mr-1" />
                  {{ agent.satisfactionScore }}/5
                </span>
              </div>
            </div>

            <!-- Last Activity -->
            <div class="pt-2 border-t text-xs text-muted-foreground">
              <p>Last active: {{ formatTimeAgo(agent.lastActivity) }}</p>
              <p>Created: {{ formatDate(agent.createdAt) }}</p>
            </div>

            <!-- Quick Actions -->
            <div class="flex space-x-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                @click="toggleAgentStatus(agent)"
              >
                <Power class="mr-1 h-3 w-3" />
                {{ agent.status === "active" ? "Disable" : "Enable" }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                @click="viewAgent(agent.id)"
              >
                <Settings class="mr-1 h-3 w-3" />
                Manage
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!loading && filteredAgents.length === 0"
      class="text-center py-12"
    >
      <Bot class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">
        {{
          searchQuery || statusFilter || typeFilter
            ? "No agents found"
            : "No agents yet"
        }}
      </h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {{
          searchQuery || statusFilter || typeFilter
            ? "Try adjusting your search or filters."
            : "Get started by creating your first AI agent."
        }}
      </p>
      <div class="mt-6">
        <Button
          @click="
            searchQuery || statusFilter || typeFilter
              ? clearFilters()
              : createAgent()
          "
        >
          {{
            searchQuery || statusFilter || typeFilter
              ? "Clear Filters"
              : "Create Agent"
          }}
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="i in 6" :key="i" class="animate-pulse">
        <CardHeader>
          <div class="flex items-start space-x-3">
            <div class="h-12 w-12 bg-muted rounded-lg"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-muted rounded w-3/4"></div>
              <div class="h-3 bg-muted rounded w-1/2"></div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <div class="h-3 bg-muted rounded w-1/2"></div>
                <div class="h-4 bg-muted rounded w-3/4"></div>
              </div>
              <div class="space-y-1">
                <div class="h-3 bg-muted rounded w-1/2"></div>
                <div class="h-4 bg-muted rounded w-3/4"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Pagination -->
    <DataPagination
      v-if="!loading && filteredAgents.length > 0"
      :current-page="currentPage"
      :total-pages="totalPages"
      :items-per-page="pageSize"
      :total-items="filteredAgents.length"
      @page-change="handlePageChange"
      @items-per-page-change="handleItemsPerPageChange"
    />

    <!-- Toast Container -->
    <ToastContainer />

    <!-- Confirm Delete Dialog -->
    <ConfirmDialog
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      confirm-text="Delete"
      :destructive="true"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import {
  Bot,
  Plus,
  RefreshCw,
  Search,
  Settings,
  MoreVertical,
  Power,
  Download,
  Trash2,
  Star,
} from "lucide-vue-next";

import { useRouter } from "vue-router";
import { useToast } from "@/composables/useToast";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import ToastContainer from "@/components/ui/ToastContainer.vue";
import { HayApi } from "@/utils/api";

definePageMeta({
  // Auth is handled by global middleware
});

// State
const loading = ref(false);
const searchQuery = ref("");
const statusFilter = ref("");
const typeFilter = ref("");
const selectedAgents = ref<string[]>([]);
const router = useRouter();
const toast = useToast();
const currentPage = ref(1);
const pageSize = ref(10);

// Agents data from API
const agents = ref<any[]>([]);

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref("");
const deleteDialogDescription = ref("");
const agentToDelete = ref<any>(null);
const isBulkDelete = ref(false);

// Computed
const filteredAgents = computed(() => {
  let filtered = agents.value;

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query)
    );
  }

  // Apply status filter
  if (statusFilter.value) {
    filtered = filtered.filter((agent) => agent.status === statusFilter.value);
  }

  // Apply type filter
  if (typeFilter.value) {
    filtered = filtered.filter((agent) => agent.type === typeFilter.value);
  }

  return filtered;
});

// Paginated agents
const paginatedAgents = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredAgents.value.slice(start, end);
});

// Total pages
const totalPages = computed(() => 
  Math.ceil(filteredAgents.value.length / pageSize.value)
);

// Methods
const formatTimeAgo = (date: Date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "Just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}m ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days}d ago`;
  }
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

const refreshData = async () => {
  loading.value = true;
  try {
    const result = await HayApi.agents.list.query();
    agents.value = result.map((agent: any) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description || '',
      status: agent.enabled ? 'active' : 'inactive',
      type: 'general',
      conversationCount: 0,
      resolutionRate: 0,
      avgResponseTime: 0,
      satisfactionScore: 0,
      lastActivity: new Date(agent.updated_at),
      createdAt: new Date(agent.created_at),
      enabled: agent.enabled,
      instructions: agent.instructions
    }));
  } catch (error: any) {
    console.error("Error refreshing data:", error);
    toast.error(error.message || 'Failed to load agents');
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  // Search is reactive through computed property
  // TODO: Add debouncing for API calls
};

const applyFilters = () => {
  // Filters are reactive through computed property
  // TODO: Update URL query parameters
};

const clearFilters = () => {
  searchQuery.value = "";
  statusFilter.value = "";
  typeFilter.value = "";
  selectedAgents.value = [];
};

const toggleAgentSelection = (agentId: string) => {
  const index = selectedAgents.value.indexOf(agentId);
  if (index > -1) {
    selectedAgents.value.splice(index, 1);
  } else {
    selectedAgents.value.push(agentId);
  }
};

const createAgent = () => {
  router.push('/agents/create');
};

const viewAgent = (id: string) => {
  router.push(`/agents/${id}`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toggleAgentStatus = async (agent: any) => {
  try {
    const newEnabledState = agent.status !== "active";
    await HayApi.agents.update.mutate({
      id: agent.id,
      data: {
        enabled: newEnabledState
      }
    });

    // Update local state
    agent.status = newEnabledState ? "active" : "inactive";
    agent.enabled = newEnabledState;
    
    toast.success(`Agent ${newEnabledState ? 'enabled' : 'disabled'} successfully`);
  } catch (error: any) {
    console.error("Error toggling agent status:", error);
    toast.error(error.message || 'Failed to toggle agent status');
  }
};

const deleteAgent = (agent: any) => {
  agentToDelete.value = agent;
  isBulkDelete.value = false;
  deleteDialogTitle.value = "Delete Agent";
  deleteDialogDescription.value = `Are you sure you want to delete "${agent.name}"? This action cannot be undone and will also delete all associated data.`;
  
  nextTick(() => {
    showDeleteDialog.value = true;
  });
};

const bulkToggleStatus = async () => {
  try {
    // TODO: Bulk toggle status for selected agents
    console.log("Bulk toggle status for:", selectedAgents.value);

    // TODO: Show success notification
    selectedAgents.value = [];
  } catch (error) {
    console.error("Error bulk toggling status:", error);
    // TODO: Show error notification
  }
};

const bulkExport = async () => {
  try {
    // TODO: Export selected agents configuration
    console.log("Bulk export agents:", selectedAgents.value);

    // TODO: Generate and download export file
    // TODO: Show success notification
  } catch (error) {
    console.error("Error exporting agents:", error);
    // TODO: Show error notification
  }
};

const bulkDelete = () => {
  if (selectedAgents.value.length === 0) return;
  
  isBulkDelete.value = true;
  deleteDialogTitle.value = "Delete Agents";
  deleteDialogDescription.value = `Are you sure you want to delete ${selectedAgents.value.length} agent${
    selectedAgents.value.length === 1 ? "" : "s"
  }? This action cannot be undone and will also delete all associated data.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (isBulkDelete.value) {
    await performBulkDelete();
  } else {
    await performSingleDelete();
  }
};

const performSingleDelete = async () => {
  if (!agentToDelete.value) return;
  
  try {
    const result = await HayApi.agents.delete.mutate({
      id: agentToDelete.value.id,
    });
    
    if (result.success) {
      const index = agents.value.findIndex((a) => a.id === agentToDelete.value.id);
      if (index > -1) {
        agents.value.splice(index, 1);
      }
      
      toast.success(result.message || 'Agent deleted successfully');
    }
  } catch (error: any) {
    console.error("Error deleting agent:", error);
    toast.error(error.message || 'Failed to delete agent. Please try again.');
  } finally {
    agentToDelete.value = null;
  }
};

const performBulkDelete = async () => {
  const errors: string[] = [];
  const successfulDeletes: string[] = [];
  const totalCount = selectedAgents.value.length;
  
  try {
    for (const agentId of selectedAgents.value) {
      try {
        const result = await HayApi.agents.delete.mutate({
          id: agentId,
        });
        
        if (result.success) {
          successfulDeletes.push(agentId);
        }
      } catch (error) {
        errors.push(agentId);
        console.error(`Error deleting agent ${agentId}:`, error);
      }
    }
    
    agents.value = agents.value.filter(
      (agent) => !successfulDeletes.includes(agent.id)
    );
    
    selectedAgents.value = [];
    
    if (errors.length > 0) {
      toast.warning(
        `Successfully deleted ${successfulDeletes.length} agent(s). Failed to delete ${errors.length} agent(s).`
      );
    } else {
      toast.success(`Successfully deleted ${successfulDeletes.length} agent(s)`);
    }
  } catch (error: any) {
    console.error("Error deleting agents:", error);
    toast.error(error.message || 'Failed to delete agents. Please try again.');
  }
};

// Pagination handlers
const handlePageChange = (page: number) => {
  currentPage.value = page;
};

const handleItemsPerPageChange = (itemsPerPage: number) => {
  pageSize.value = itemsPerPage;
  currentPage.value = 1; // Reset to first page when changing page size
};

// Lifecycle
onMounted(async () => {
  await refreshData();
});

// TODO: Add keyboard shortcuts for common actions
// TODO: Add real-time updates for agent status
// TODO: Implement proper error handling
// TODO: Add accessibility improvements
// TODO: Add agent performance analytics

// SEO
useHead({
  title: "AI Agents - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage your AI agents and automate customer interactions",
    },
  ],
});
</script>
