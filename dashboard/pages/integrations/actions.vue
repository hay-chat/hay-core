<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">MCP Actions</h1>
        <p class="text-muted-foreground">Manage Model Context Protocol actions for your agents</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <FileText class="h-4 w-4 mr-2" />
          Documentation
        </Button>
        <Button @click="createCustomAction">
          <Plus class="h-4 w-4 mr-2" />
          Create Action
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Total Actions</span>
          <Zap class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.total }}</div>
          <p class="text-xs text-muted-foreground">Available actions</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Custom Actions</span>
          <Code class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.custom }}</div>
          <p class="text-xs text-muted-foreground">Created by you</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Executions Today</span>
          <Play class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.executionsToday }}</div>
          <p class="text-xs text-green-600">+12% from yesterday</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Success Rate</span>
          <CheckCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.successRate }}%</div>
          <p class="text-xs text-green-600">Last 30 days</p>
        </CardContent>
      </Card>
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="relative">
          <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input v-model="searchQuery" placeholder="Search actions..." class="pl-8 w-[300px]" />
        </div>

        <select v-model="selectedCategory" class="px-3 py-2 text-sm border border-input rounded-md">
          <option value="">All Categories</option>
          <option value="communication">Communication</option>
          <option value="data">Data</option>
          <option value="integration">Integration</option>
          <option value="automation">Automation</option>
          <option value="custom">Custom</option>
        </select>

        <select v-model="selectedStatus" class="px-3 py-2 text-sm border border-input rounded-md">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="testing">Testing</option>
        </select>
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="refreshActions">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="animate-pulse">
        <Card>
          <CardHeader>
            <div class="h-4 bg-gray-200 rounded w-1/3"></div>
            <div class="h-3 bg-gray-200 rounded w-2/3 mt-2"></div>
          </CardHeader>
          <CardContent>
            <div class="h-3 bg-gray-200 rounded w-full"></div>
            <div class="h-3 bg-gray-200 rounded w-1/2 mt-2"></div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredActions.length === 0" class="text-center py-12">
      <Zap class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">
        {{ searchQuery ? 'No actions found' : 'No actions available' }}
      </h3>
      <p class="text-muted-foreground mb-4">
        {{
          searchQuery
            ? 'Try adjusting your search terms.'
            : 'Create your first custom action to get started.'
        }}
      </p>
      <Button v-if="!searchQuery" @click="createCustomAction">
        <Plus class="h-4 w-4 mr-2" />
        Create First Action
      </Button>
    </div>

    <!-- Actions Grid -->
    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="action in filteredActions"
        :key="action.id"
        class="hover:shadow-md transition-shadow"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <div
                :class="[
                  'w-10 h-10 rounded-lg flex items-center justify-center',
                  getActionIconBg(action.category),
                ]"
              >
                <component :is="getActionIcon(action.category)" class="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle class="text-lg">{{ action.name }}</CardTitle>
                <CardDescription>{{ action.description }}</CardDescription>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge :variant="getStatusVariant(action.status)">
                {{ action.status }}
              </Badge>
              <Button variant="ghost" size="sm" @click="showActionMenu(action.id)">
                <MoreHorizontal class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <!-- Parameters -->
            <div>
              <div class="text-sm font-medium mb-2">Parameters</div>
              <div v-if="action.parameters.length === 0" class="text-sm text-muted-foreground">
                No parameters required
              </div>
              <div v-else class="space-y-1">
                <div
                  v-for="param in action.parameters"
                  :key="param.name"
                  class="text-sm flex items-center justify-between"
                >
                  <span class="font-mono">{{ param.name }}</span>
                  <div class="flex items-center space-x-2">
                    <Badge variant="outline" class="text-xs">{{ param.type }}</Badge>
                    <span v-if="param.required" class="text-red-500 text-xs">*</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Usage Stats -->
            <div class="grid gap-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Executions:</span>
                <span class="font-medium">{{ action.stats.executions }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Success Rate:</span>
                <span class="font-medium text-green-600">{{ action.stats.successRate }}%</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Last Used:</span>
                <span class="font-medium">{{ formatDate(action.stats.lastUsed) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Used in Playbooks:</span>
                <span class="font-medium">{{ action.playbookCount || 0 }}</span>
              </div>
            </div>

            <!-- Test Action -->
            <div class="space-y-2">
              <div class="text-sm font-medium">Test Action</div>
              <div class="space-y-2">
                <div
                  v-for="param in action.parameters.filter((p) => p.required)"
                  :key="param.name"
                  class="space-y-1"
                >
                  <Label class="text-xs">{{ param.name }}</Label>
                  <Input
                    v-model="(testParameters[action.id] = testParameters[action.id] || {})[param.name]"
                    :placeholder="param.description"
                    size="sm"
                    class="text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  class="w-full"
                  :disabled="testingAction === action.id"
                  @click="testAction(action.id)"
                >
                  <Play class="h-3 w-3 mr-2" />
                  {{ testingAction === action.id ? 'Testing...' : 'Test Action' }}
                </Button>
              </div>
            </div>

            <!-- Test Result -->
            <div v-if="testResults[action.id]" class="space-y-2">
              <div class="text-sm font-medium">Test Result</div>
              <div class="p-2 bg-muted rounded text-xs">
                <div class="flex items-center justify-between mb-1">
                  <span class="font-medium">Status:</span>
                  <Badge :variant="testResults[action.id].success ? 'success' : 'destructive'">
                    {{ testResults[action.id].success ? 'Success' : 'Error' }}
                  </Badge>
                </div>
                <pre class="text-xs overflow-x-auto">{{
                  JSON.stringify(testResults[action.id].data, null, 2)
                }}</pre>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex space-x-2">
              <Button
                v-if="action.category === 'custom'"
                variant="outline"
                size="sm"
                @click="editAction(action.id)"
              >
                <Edit class="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button variant="outline" size="sm" @click="duplicateAction(action.id)">
                <Copy class="h-3 w-3 mr-1" />
                Duplicate
              </Button>
              <Button variant="outline" size="sm" @click="viewActionLogs(action.id)">
                <BarChart3 class="h-3 w-3 mr-1" />
                Logs
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Plus,
  Zap,
  Code,
  Play,
  CheckCircle,
  Search,
  RefreshCcw,
  MoreHorizontal,
  Edit,
  Copy,
  BarChart3,
  FileText,
  Database,
  Globe,
  Cog,
  Mail,
  MessageSquare,
  Calendar,
  DollarSign,
} from 'lucide-vue-next';

import Card from '~/components/ui/Card.vue';
const CardContent = Card;
const CardHeader = Card;
const CardTitle = Card;
const CardDescription = Card;

// TODO: Import actual Badge component when available
const Badge = ({ variant = 'default', ...props }) =>
  h('span', {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === 'outline'
        ? 'border border-gray-300 text-gray-700'
        : variant === 'secondary'
          ? 'bg-blue-100 text-blue-800'
          : variant === 'destructive'
            ? 'bg-red-100 text-red-800'
            : variant === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
    }`,
    ...props,
  });

// Reactive state
const loading = ref(true);
const searchQuery = ref('');
const selectedCategory = ref('');
const selectedStatus = ref('');
const testingAction = ref<string | null>(null);
const testParameters = ref<Record<string, Record<string, any>>>({});
const testResults = ref<Record<string, any>>({});

// Mock data - TODO: Replace with actual API calls
const stats = ref({
  total: 24,
  custom: 8,
  executionsToday: 342,
  successRate: 97.2,
});

const actions = ref([
  {
    id: 'create-ticket',
    name: 'Create Support Ticket',
    description: 'Create a new support ticket in your ticketing system',
    category: 'communication',
    status: 'active',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'Ticket title' },
      { name: 'description', type: 'string', required: true, description: 'Ticket description' },
      { name: 'priority', type: 'string', required: false, description: 'Ticket priority' },
    ],
    stats: {
      executions: 145,
      successRate: 98.5,
      lastUsed: new Date('2024-01-15T14:20:00'),
    },
    playbookCount: 12,
  },
  {
    id: 'send-email',
    name: 'Send Email',
    description: 'Send an email to a customer or team member',
    category: 'communication',
    status: 'active',
    parameters: [
      { name: 'to', type: 'string', required: true, description: 'Recipient email' },
      { name: 'subject', type: 'string', required: true, description: 'Email subject' },
      { name: 'body', type: 'string', required: true, description: 'Email body' },
    ],
    stats: {
      executions: 89,
      successRate: 96.8,
      lastUsed: new Date('2024-01-15T13:45:00'),
    },
    playbookCount: 8,
  },
  {
    id: 'get-user-data',
    name: 'Get User Data',
    description: 'Retrieve user information from your database',
    category: 'data',
    status: 'active',
    parameters: [
      { name: 'userId', type: 'string', required: true, description: 'User ID or email' },
    ],
    stats: {
      executions: 234,
      successRate: 99.1,
      lastUsed: new Date('2024-01-15T14:30:00'),
    },
    playbookCount: 15,
  },
  {
    id: 'update-crm',
    name: 'Update CRM Record',
    description: 'Update customer record in your CRM system',
    category: 'integration',
    status: 'active',
    parameters: [
      { name: 'contactId', type: 'string', required: true, description: 'Contact ID' },
      { name: 'fields', type: 'object', required: true, description: 'Fields to update' },
    ],
    stats: {
      executions: 67,
      successRate: 94.2,
      lastUsed: new Date('2024-01-15T12:15:00'),
    },
    playbookCount: 6,
  },
  {
    id: 'schedule-meeting',
    name: 'Schedule Meeting',
    description: 'Schedule a meeting using calendar integration',
    category: 'automation',
    status: 'active',
    parameters: [
      { name: 'attendees', type: 'array', required: true, description: 'Meeting attendees' },
      { name: 'title', type: 'string', required: true, description: 'Meeting title' },
      { name: 'duration', type: 'number', required: false, description: 'Duration in minutes' },
    ],
    stats: {
      executions: 23,
      successRate: 91.3,
      lastUsed: new Date('2024-01-15T11:30:00'),
    },
    playbookCount: 3,
  },
  {
    id: 'get-weather',
    name: 'Get Weather',
    description: 'Get current weather information for a location',
    category: 'data',
    status: 'testing',
    parameters: [
      { name: 'location', type: 'string', required: true, description: 'City name or coordinates' },
    ],
    stats: {
      executions: 5,
      successRate: 100,
      lastUsed: new Date('2024-01-14T16:20:00'),
    },
    playbookCount: 1,
  },
  {
    id: 'calculate-refund',
    name: 'Calculate Refund',
    description: 'Calculate refund amount based on business rules',
    category: 'custom',
    status: 'active',
    parameters: [
      { name: 'orderId', type: 'string', required: true, description: 'Order ID' },
      { name: 'reason', type: 'string', required: true, description: 'Refund reason' },
    ],
    stats: {
      executions: 34,
      successRate: 97.1,
      lastUsed: new Date('2024-01-15T10:45:00'),
    },
    playbookCount: 4,
  },
  {
    id: 'translate-text',
    name: 'Translate Text',
    description: 'Translate text between different languages',
    category: 'data',
    status: 'active',
    parameters: [
      { name: 'text', type: 'string', required: true, description: 'Text to translate' },
      {
        name: 'targetLanguage',
        type: 'string',
        required: true,
        description: 'Target language code',
      },
    ],
    stats: {
      executions: 156,
      successRate: 98.7,
      lastUsed: new Date('2024-01-15T13:20:00'),
    },
    playbookCount: 7,
  },
]);

// Initialize test parameters
actions.value.forEach((action) => {
  testParameters.value[action.id] = {};
  action.parameters?.forEach((param) => {
    const actionParams = testParameters.value[action.id];
    if (actionParams) {
      actionParams[param.name] = '';
    }
  });
});

// Computed properties
const filteredActions = computed(() => {
  return actions.value.filter((action) => {
    const matchesSearch =
      !searchQuery.value ||
      action.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      action.description.toLowerCase().includes(searchQuery.value.toLowerCase());

    const matchesCategory = !selectedCategory.value || action.category === selectedCategory.value;
    const matchesStatus = !selectedStatus.value || action.status === selectedStatus.value;

    return matchesSearch && matchesCategory && matchesStatus;
  });
});

// Methods
const getActionIcon = (category: string) => {
  const icons = {
    communication: Mail,
    data: Database,
    integration: Globe,
    automation: Cog,
    custom: Code,
  };
  return icons[category as keyof typeof icons] || Zap;
};

const getActionIconBg = (category: string) => {
  const backgrounds = {
    communication: 'bg-blue-600',
    data: 'bg-green-600',
    integration: 'bg-purple-600',
    automation: 'bg-orange-600',
    custom: 'bg-gray-600',
  };
  return backgrounds[category as keyof typeof backgrounds] || 'bg-gray-600';
};

const getStatusVariant = (status: string) => {
  const variants = {
    active: 'success',
    inactive: 'secondary',
    testing: 'outline',
  };
  return variants[status as keyof typeof variants] || 'default';
};

const formatDate = (date: Date) => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  } else if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return 'Just now';
  }
};

const testAction = async (actionId: string) => {
  testingAction.value = actionId;

  try {
    const action = actions.value.find((a) => a.id === actionId);
    const params = testParameters.value[actionId];

    // TODO: Implement actual action testing
    console.log('Test action:', actionId, 'with params:', params);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Mock response
    const mockResults = {
      'create-ticket': { ticketId: 'TICK-12345', status: 'created' },
      'send-email': { messageId: 'msg_abc123', delivered: true },
      'get-user-data': {
        userId: params?.['userId'],
        name: 'John Doe',
        email: 'john@example.com',
        status: 'active',
      },
      'update-crm': { contactId: params?.['contactId'], updated: true },
      'schedule-meeting': { meetingId: 'meet_xyz789', scheduled: true },
      'get-weather': {
        location: params?.['location'],
        temperature: '72°F',
        condition: 'Sunny',
      },
      'calculate-refund': {
        orderId: params?.['orderId'],
        refundAmount: 49.99,
        currency: 'USD',
      },
      'translate-text': {
        originalText: params?.['text'],
        translatedText: 'Hola mundo',
        targetLanguage: params?.['targetLanguage'],
      },
    };

    testResults.value[actionId] = {
      success: true,
      data: mockResults[actionId as keyof typeof mockResults] || { result: 'Action executed successfully' },
    };
  } catch (error) {
    testResults.value[actionId] = {
      success: false,
      data: { error: 'Failed to execute action' },
    };
  } finally {
    testingAction.value = null;
  }
};

const createCustomAction = () => {
  // TODO: Open custom action creation modal
  console.log('Create custom action');
};

const editAction = (actionId: string) => {
  // TODO: Open action editor
  console.log('Edit action:', actionId);
};

const duplicateAction = (actionId: string) => {
  // TODO: Duplicate action
  console.log('Duplicate action:', actionId);
};

const viewActionLogs = (actionId: string) => {
  // TODO: Show action execution logs
  console.log('View logs for action:', actionId);
};

const showActionMenu = (actionId: string) => {
  // TODO: Show action context menu
  console.log('Show menu for action:', actionId);
};

const refreshActions = () => {
  // TODO: Refresh actions from API
  console.log('Refresh actions');
};

// Lifecycle
onMounted(async () => {
  // TODO: Fetch actions from API
  // await fetchActions()

  // Simulate loading
  setTimeout(() => {
    loading.value = false;
  }, 1000);
});

// Set page meta
definePageMeta({
  layout: 'default',
  middleware: 'auth',
});

// Head management
useHead({
  title: 'MCP Actions - Hay Dashboard',
  meta: [{ name: 'description', content: 'Manage Model Context Protocol actions for your agents' }],
});
</script>
