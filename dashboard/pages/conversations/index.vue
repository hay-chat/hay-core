<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Conversations</h1>
        <p class="text-muted-foreground">Monitor and manage all customer conversations</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <Download class="h-4 w-4 mr-2" />
          Export
        </Button>
        <Button variant="outline" size="sm" @click="refreshConversations">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Total Conversations</span>
          <MessageSquare class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.total }}</div>
          <p class="text-xs text-muted-foreground">+{{ stats.todayIncrease }} today</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Active Now</span>
          <Activity class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.active }}</div>
          <p class="text-xs text-muted-foreground">Real-time conversations</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Avg Response Time</span>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.avgResponseTime }}s</div>
          <p class="text-xs text-green-600">-12% from yesterday</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Satisfaction Rate</span>
          <Heart class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.satisfactionRate }}%</div>
          <p class="text-xs text-green-600">+3.2% this week</p>
        </CardContent>
      </Card>
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="relative">
          <Search class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            v-model="searchQuery"
            placeholder="Search conversations..."
            class="pl-8 w-[300px]"
          />
        </div>

        <select v-model="selectedStatus" class="px-3 py-2 text-sm border border-input rounded-md">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
          <option value="closed">Closed</option>
        </select>

        <select v-model="selectedAgent" class="px-3 py-2 text-sm border border-input rounded-md">
          <option value="">All Agents</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }}
          </option>
        </select>

        <select
          v-model="selectedTimeframe"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleBulkMode">
          <CheckSquare class="h-4 w-4 mr-2" />
          {{ bulkMode ? 'Exit' : 'Select' }}
        </Button>
        <Button v-if="selectedConversations.length > 0" variant="outline" size="sm">
          <Archive class="h-4 w-4 mr-2" />
          Archive ({{ selectedConversations.length }})
        </Button>
      </div>
    </div>

    <!-- Real-time indicator -->
    <div
      v-if="realTimeEnabled"
      class="flex items-center space-x-2 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-md"
    >
      <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
      <span>Real-time updates enabled</span>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <Card>
          <CardContent class="p-4">
            <div class="flex items-center space-x-4">
              <div class="w-10 h-10 bg-gray-200 rounded-full"></div>
              <div class="flex-1">
                <div class="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div class="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
              <div class="h-3 bg-gray-200 rounded w-16"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredConversations.length === 0" class="text-center py-12">
      <MessageSquare class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">
        {{ searchQuery ? 'No conversations found' : 'No conversations yet' }}
      </h3>
      <p class="text-muted-foreground">
        {{
          searchQuery
            ? 'Try adjusting your search terms or filters.'
            : 'Conversations will appear here once customers start chatting.'
        }}
      </p>
    </div>

    <!-- Conversations Table -->
    <Card v-else>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="border-b">
              <tr>
                <th v-if="bulkMode" class="text-left py-3 px-4 w-12">
                  <Checkbox
                    :checked="selectedConversations.length === filteredConversations.length"
                    @update:checked="toggleSelectAll"
                  />
                </th>
                <th class="text-left py-3 px-4 font-medium">Customer</th>
                <th class="text-left py-3 px-4 font-medium">Agent</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Last Message</th>
                <th class="text-left py-3 px-4 font-medium">Duration</th>
                <th class="text-left py-3 px-4 font-medium">Satisfaction</th>
                <th class="text-left py-3 px-4 font-medium">Updated</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="conversation in filteredConversations"
                :key="conversation.id"
                class="border-b hover:bg-muted/50 cursor-pointer"
                @click="!bulkMode && viewConversation(conversation.id)"
              >
                <td v-if="bulkMode" class="py-3 px-4" @click.stop>
                  <Checkbox
                    :checked="selectedConversations.includes(conversation.id)"
                    @update:checked="toggleConversationSelection(conversation.id)"
                  />
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-3">
                    <div
                      class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center"
                    >
                      <User class="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div class="font-medium">{{ conversation.customer.name }}</div>
                      <div class="text-sm text-muted-foreground">
                        {{ conversation.customer.email }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-2">
                    <div class="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                      <Bot class="h-3 w-3 text-blue-600" />
                    </div>
                    <span class="text-sm">{{ conversation.agent.name }}</span>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <Badge :variant="getStatusVariant(conversation.status)">
                    <div class="flex items-center space-x-1">
                      <component :is="getStatusIcon(conversation.status)" class="h-3 w-3" />
                      <span>{{ conversation.status }}</span>
                    </div>
                  </Badge>
                </td>
                <td class="py-3 px-4 max-w-xs">
                  <div class="truncate text-sm">{{ conversation.lastMessage.preview }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ conversation.lastMessage.sender === 'customer' ? 'Customer' : 'Agent' }}
                  </div>
                </td>
                <td class="py-3 px-4 text-sm">{{ formatDuration(conversation.duration) }}</td>
                <td class="py-3 px-4">
                  <div v-if="conversation.satisfaction" class="flex items-center space-x-1">
                    <Star class="h-4 w-4 text-yellow-500 fill-current" />
                    <span class="text-sm">{{ conversation.satisfaction }}/5</span>
                  </div>
                  <span v-else class="text-xs text-muted-foreground">Not rated</span>
                </td>
                <td class="py-3 px-4 text-sm text-muted-foreground">
                  {{ formatDate(conversation.updatedAt) }}
                </td>
                <td class="py-3 px-4" @click.stop>
                  <div class="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" @click="viewConversation(conversation.id)">
                      <Eye class="h-4 w-4" />
                    </Button>
                    <Button
                      v-if="conversation.status === 'active'"
                      variant="ghost"
                      size="sm"
                      @click="takeOverConversation(conversation.id)"
                    >
                      <UserCheck class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" @click="showMoreActions(conversation.id)">
                      <MoreHorizontal class="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <!-- Pagination -->
    <div
      v-if="!loading && filteredConversations.length > 0"
      class="flex items-center justify-between"
    >
      <div class="text-sm text-muted-foreground">
        Showing {{ (currentPage - 1) * pageSize + 1 }} to
        {{ Math.min(currentPage * pageSize, totalConversations) }} of
        {{ totalConversations }} conversations
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" :disabled="currentPage === 1" @click="previousPage">
          <ChevronLeft class="h-4 w-4" />
          Previous
        </Button>
        <span class="px-3 py-1 text-sm border rounded">{{ currentPage }}</span>
        <Button
          variant="outline"
          size="sm"
          :disabled="currentPage * pageSize >= totalConversations"
          @click="nextPage"
        >
          Next
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  MessageSquare,
  Activity,
  Clock,
  Heart,
  Search,
  Download,
  RefreshCcw,
  CheckSquare,
  Archive,
  User,
  Bot,
  Star,
  Eye,
  UserCheck,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Circle,
  CheckCircle,
  AlertTriangle,
  XCircle,
} from 'lucide-vue-next';

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
              : variant === 'warning'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-100 text-gray-800'
    }`,
    ...props,
  });

// Reactive state
const loading = ref(true);
const realTimeEnabled = ref(true);
const searchQuery = ref('');
const selectedStatus = ref('');
const selectedAgent = ref('');
const selectedTimeframe = ref('week');
const bulkMode = ref(false);
const selectedConversations = ref<string[]>([]);
const currentPage = ref(1);
const pageSize = ref(25);

// Mock data - TODO: Replace with actual API calls
const stats = ref({
  total: 1847,
  active: 23,
  avgResponseTime: 4.2,
  satisfactionRate: 92,
  todayIncrease: 45,
});

const agents = ref([
  { id: '1', name: 'Customer Support Agent' },
  { id: '2', name: 'Sales Assistant' },
  { id: '3', name: 'Technical Support' },
]);

const conversations = ref([
  {
    id: '1',
    customer: {
      name: 'Alice Johnson',
      email: 'alice@example.com',
    },
    agent: {
      name: 'Customer Support Agent',
    },
    status: 'active',
    lastMessage: {
      preview: 'I need help with my billing statement, can you explain this charge?',
      sender: 'customer',
    },
    duration: 485, // seconds
    satisfaction: null,
    updatedAt: new Date('2024-01-15T14:30:00'),
    createdAt: new Date('2024-01-15T14:22:00'),
  },
  {
    id: '2',
    customer: {
      name: 'Bob Smith',
      email: 'bob@example.com',
    },
    agent: {
      name: 'Technical Support',
    },
    status: 'resolved',
    lastMessage: {
      preview: 'Thank you for your help! The issue is now resolved.',
      sender: 'customer',
    },
    duration: 1240,
    satisfaction: 5,
    updatedAt: new Date('2024-01-15T13:45:00'),
    createdAt: new Date('2024-01-15T13:24:00'),
  },
  {
    id: '3',
    customer: {
      name: 'Carol Williams',
      email: 'carol@example.com',
    },
    agent: {
      name: 'Sales Assistant',
    },
    status: 'escalated',
    lastMessage: {
      preview: 'This requires special pricing approval for enterprise features.',
      sender: 'agent',
    },
    duration: 2100,
    satisfaction: null,
    updatedAt: new Date('2024-01-15T12:20:00'),
    createdAt: new Date('2024-01-15T11:45:00'),
  },
  {
    id: '4',
    customer: {
      name: 'David Brown',
      email: 'david@example.com',
    },
    agent: {
      name: 'Customer Support Agent',
    },
    status: 'closed',
    lastMessage: {
      preview: 'Perfect, that solved my problem. Thanks!',
      sender: 'customer',
    },
    duration: 320,
    satisfaction: 4,
    updatedAt: new Date('2024-01-15T11:10:00'),
    createdAt: new Date('2024-01-15T11:05:00'),
  },
]);

const totalConversations = computed(() => filteredConversations.value.length);

// Computed properties
const filteredConversations = computed(() => {
  return conversations.value
    .filter((conversation) => {
      const matchesSearch =
        !searchQuery.value ||
        conversation.customer.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        conversation.customer.email.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        conversation.lastMessage.preview.toLowerCase().includes(searchQuery.value.toLowerCase());

      const matchesStatus = !selectedStatus.value || conversation.status === selectedStatus.value;
      const matchesAgent =
        !selectedAgent.value || conversation.agent.name.includes(selectedAgent.value);

      // TODO: Implement timeframe filtering
      const matchesTimeframe = true;

      return matchesSearch && matchesStatus && matchesAgent && matchesTimeframe;
    })
    .slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value);
});

// Methods
const getStatusVariant = (status: string) => {
  const variants = {
    active: 'default',
    resolved: 'success',
    escalated: 'warning',
    closed: 'secondary',
  };
  return variants[status as keyof typeof variants] || 'default';
};

const getStatusIcon = (status: string) => {
  const icons = {
    active: Circle,
    resolved: CheckCircle,
    escalated: AlertTriangle,
    closed: XCircle,
  };
  return icons[status as keyof typeof icons] || Circle;
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
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

const toggleBulkMode = () => {
  bulkMode.value = !bulkMode.value;
  if (!bulkMode.value) {
    selectedConversations.value = [];
  }
};

const toggleSelectAll = (checked: boolean) => {
  if (checked) {
    selectedConversations.value = filteredConversations.value.map((c) => c.id);
  } else {
    selectedConversations.value = [];
  }
};

const toggleConversationSelection = (id: string) => {
  const index = selectedConversations.value.indexOf(id);
  if (index > -1) {
    selectedConversations.value.splice(index, 1);
  } else {
    selectedConversations.value.push(id);
  }
};

const viewConversation = (id: string) => {
  navigateTo(`/conversations/${id}`);
};

const takeOverConversation = (id: string) => {
  // TODO: Implement conversation takeover
  console.log('Take over conversation:', id);
};

const showMoreActions = (id: string) => {
  // TODO: Show more actions menu
  console.log('Show more actions for conversation:', id);
};

const refreshConversations = () => {
  // TODO: Refresh conversations from API
  console.log('Refresh conversations');
};

const previousPage = () => {
  if (currentPage.value > 1) {
    currentPage.value--;
  }
};

const nextPage = () => {
  if (currentPage.value * pageSize.value < totalConversations.value) {
    currentPage.value++;
  }
};

// Lifecycle
onMounted(async () => {
  // TODO: Fetch conversations from API
  // await fetchConversations()
  // await fetchAgents()
  // setupRealTimeUpdates()

  // Simulate loading
  setTimeout(() => {
    loading.value = false;
  }, 1000);
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  // TODO: Cleanup WebSocket connections
});

// Set page meta
definePageMeta({
  layout: 'default',
  middleware: 'auth',
});

// Head management
useHead({
  title: 'Conversations - Hay Dashboard',
  meta: [{ name: 'description', content: 'Monitor and manage all customer conversations' }],
});
</script>
