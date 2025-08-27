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
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
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
          {{ selectedAgents.length }} agent{{ selectedAgents.length === 1 ? '' : 's' }} selected
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
        v-for="agent in filteredAgents"
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
                <CardDescription class="mt-1">{{ agent.description }}</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="showOptionsMenu(agent)">
              <MoreVertical class="h-4 w-4" />
            </Button>
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
              <span class="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                {{ agent.type }}
              </span>
            </div>

            <!-- Agent Stats -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p class="text-muted-foreground">Conversations</p>
                <p class="font-medium">{{ agent.conversationCount.toLocaleString() }}</p>
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
              <Button variant="outline" size="sm" class="flex-1" @click="toggleAgentStatus(agent)">
                <Power class="mr-1 h-3 w-3" />
                {{ agent.status === 'active' ? 'Disable' : 'Enable' }}
              </Button>
              <Button variant="outline" size="sm" class="flex-1" @click="viewAgent(agent.id)">
                <Settings class="mr-1 h-3 w-3" />
                Manage
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && filteredAgents.length === 0" class="text-center py-12">
      <Bot class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">
        {{ searchQuery || statusFilter || typeFilter ? 'No agents found' : 'No agents yet' }}
      </h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {{
          searchQuery || statusFilter || typeFilter
            ? 'Try adjusting your search or filters.'
            : 'Get started by creating your first AI agent.'
        }}
      </p>
      <div class="mt-6">
        <Button @click="searchQuery || statusFilter || typeFilter ? clearFilters() : createAgent()">
          {{ searchQuery || statusFilter || typeFilter ? 'Clear Filters' : 'Create Agent' }}
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
} from 'lucide-vue-next';

// TODO: Import agent store/composable
// TODO: Import router for navigation

definePageMeta({
  // TODO: Add authentication middleware
  // middleware: 'auth'
});

// State
const loading = ref(false);
const searchQuery = ref('');
const statusFilter = ref('');
const typeFilter = ref('');
const selectedAgents = ref<string[]>([]);

// Mock agents data - TODO: Replace with real API calls
const agents = ref([
  {
    id: '1',
    name: 'Customer Support Bot',
    description: 'Handles general customer inquiries and support tickets',
    status: 'active',
    type: 'customer-support',
    conversationCount: 1234,
    resolutionRate: 94,
    avgResponseTime: 1.2,
    satisfactionScore: 4.6,
    lastActivity: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
    createdAt: new Date('2023-01-15'),
  },
  {
    id: '2',
    name: 'Sales Assistant',
    description: 'Qualifies leads and schedules sales meetings',
    status: 'active',
    type: 'sales',
    conversationCount: 892,
    resolutionRate: 87,
    avgResponseTime: 2.1,
    satisfactionScore: 4.3,
    lastActivity: new Date(Date.now() - 1000 * 60 * 45), // 45 minutes ago
    createdAt: new Date('2023-02-20'),
  },
  {
    id: '3',
    name: 'Technical Support',
    description: 'Provides technical assistance and troubleshooting',
    status: 'active',
    type: 'technical',
    conversationCount: 567,
    resolutionRate: 91,
    avgResponseTime: 3.5,
    satisfactionScore: 4.5,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    createdAt: new Date('2023-03-10'),
  },
  {
    id: '4',
    name: 'Billing Assistant',
    description: 'Handles billing inquiries and payment issues',
    status: 'inactive',
    type: 'customer-support',
    conversationCount: 345,
    resolutionRate: 89,
    avgResponseTime: 1.8,
    satisfactionScore: 4.2,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    createdAt: new Date('2023-04-05'),
  },
  {
    id: '5',
    name: 'Product Demo Bot',
    description: 'Provides product demonstrations and feature explanations',
    status: 'training',
    type: 'sales',
    conversationCount: 78,
    resolutionRate: 76,
    avgResponseTime: 4.2,
    satisfactionScore: 3.9,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 6), // 6 hours ago
    createdAt: new Date('2023-11-12'),
  },
  {
    id: '6',
    name: 'General Assistant',
    description: 'Handles miscellaneous inquiries and provides general information',
    status: 'error',
    type: 'general',
    conversationCount: 156,
    resolutionRate: 82,
    avgResponseTime: 2.8,
    satisfactionScore: 4.0,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
    createdAt: new Date('2023-10-20'),
  },
]);

// Computed
const filteredAgents = computed(() => {
  let filtered = agents.value;

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query),
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

// Methods
const formatTimeAgo = (date: Date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
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
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const refreshData = async () => {
  loading.value = true;
  try {
    // TODO: Fetch agents from API
    console.log('Refreshing agents data...');

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error('Error refreshing data:', error);
    // TODO: Show error notification
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
  searchQuery.value = '';
  statusFilter.value = '';
  typeFilter.value = '';
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
  // TODO: Navigate to agent creation wizard
  // await navigateTo('/agents/new')
  console.log('Create agent');
};

const viewAgent = (id: string) => {
  // TODO: Navigate to agent detail page
  // await navigateTo(`/agents/${id}`)
  console.log('View agent:', id);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toggleAgentStatus = async (agent: any) => {
  try {
    // TODO: Toggle agent status via API
    console.log('Toggle agent status:', agent.id);

    // Update local state
    agent.status = agent.status === 'active' ? 'inactive' : 'active';

    // TODO: Show success notification
  } catch (error) {
    console.error('Error toggling agent status:', error);
    // TODO: Show error notification
  }
};

const showOptionsMenu = (agent: any) => {
  // TODO: Show context menu with options like:
  // - View details
  // - Edit configuration
  // - Clone agent
  // - Export settings
  // - Delete agent
  console.log('Show options for agent:', agent.id);
};

const bulkToggleStatus = async () => {
  try {
    // TODO: Bulk toggle status for selected agents
    console.log('Bulk toggle status for:', selectedAgents.value);

    // TODO: Show success notification
    selectedAgents.value = [];
  } catch (error) {
    console.error('Error bulk toggling status:', error);
    // TODO: Show error notification
  }
};

const bulkExport = async () => {
  try {
    // TODO: Export selected agents configuration
    console.log('Bulk export agents:', selectedAgents.value);

    // TODO: Generate and download export file
    // TODO: Show success notification
  } catch (error) {
    console.error('Error exporting agents:', error);
    // TODO: Show error notification
  }
};

const bulkDelete = async () => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Delete selected agents
    console.log('Bulk delete agents:', selectedAgents.value);

    // TODO: Remove from local state
    // TODO: Show success notification
    selectedAgents.value = [];
  } catch (error) {
    console.error('Error deleting agents:', error);
    // TODO: Show error notification
  }
};

// Lifecycle
onMounted(async () => {
  // TODO: Load agents on mount
  console.log('Agents page mounted');

  // Load data
  await refreshData();
});

// TODO: Add keyboard shortcuts for common actions
// TODO: Add real-time updates for agent status
// TODO: Implement proper error handling
// TODO: Add accessibility improvements
// TODO: Add agent performance analytics

// SEO
useHead({
  title: 'AI Agents - Hay Dashboard',
  meta: [
    { name: 'description', content: 'Manage your AI agents and automate customer interactions' },
  ],
});
</script>
