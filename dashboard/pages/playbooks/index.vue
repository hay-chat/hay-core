<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Playbooks</h1>
        <p class="text-muted-foreground">
          Automated conversation flows and responses for your agents
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <FileText class="h-4 w-4 mr-2" />
          Import
        </Button>
        <Button @click="createPlaybook">
          <Plus class="h-4 w-4 mr-2" />
          Create Playbook
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Total Playbooks</span>
          <Book class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.total }}</div>
          <p class="text-xs text-muted-foreground">
            +{{ stats.newThisMonth }} this month
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Active</span>
          <Play class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.active }}</div>
          <p class="text-xs text-muted-foreground">
            {{ Math.round((stats.active / stats.total) * 100) }}% of total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Avg Success Rate</span>
          <Target class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.avgSuccessRate }}%</div>
          <p class="text-xs text-green-600">+2.1% from last month</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          class="flex flex-row items-center justify-between space-y-0 pb-2"
        >
          <span class="text-sm font-medium">Total Triggers</span>
          <Zap class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.totalTriggers }}</div>
          <p class="text-xs text-muted-foreground">Last 30 days</p>
        </CardContent>
      </Card>
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="relative">
          <Search
            class="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search playbooks..."
            class="pl-8 w-[300px]"
          />
        </div>

        <select
          v-model="selectedCategory"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="">All Categories</option>
          <option value="customer-support">Customer Support</option>
          <option value="sales">Sales</option>
          <option value="technical">Technical</option>
          <option value="custom">Custom</option>
        </select>

        <select
          v-model="selectedStatus"
          class="px-3 py-2 text-sm border border-input rounded-md"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleView">
          <LayoutGrid v-if="viewMode === 'table'" class="h-4 w-4" />
          <List v-else class="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm">
          <Filter class="h-4 w-4 mr-2" />
          More Filters
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
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
    <div v-else-if="filteredPlaybooks.length === 0" class="text-center py-12">
      <Book class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">
        {{ searchQuery ? "No playbooks found" : "No playbooks created yet" }}
      </h3>
      <p class="text-muted-foreground mb-4">
        {{
          searchQuery
            ? "Try adjusting your search terms."
            : "Create your first playbook to automate conversations."
        }}
      </p>
      <Button v-if="!searchQuery" @click="createPlaybook">
        <Plus class="h-4 w-4 mr-2" />
        Create Your First Playbook
      </Button>
    </div>

    <!-- Playbooks Grid View -->
    <div
      v-else-if="viewMode === 'grid'"
      class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      <Card
        v-for="playbook in filteredPlaybooks"
        :key="playbook.id"
        class="hover:shadow-md transition-shadow cursor-pointer"
        @click="editPlaybook(playbook.id)"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="space-y-2">
              <div class="flex items-center space-x-2">
                <Badge :variant="getStatusVariant(playbook.status)">
                  {{ playbook.status }}
                </Badge>
                <Badge variant="outline">
                  {{ getCategoryLabel(playbook.category) }}
                </Badge>
              </div>
              <h3 class="font-semibold">{{ playbook.name }}</h3>
              <p class="text-sm text-muted-foreground">
                {{ playbook.description }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              @click.stop="togglePlaybookStatus(playbook.id)"
            >
              <MoreHorizontal class="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Trigger:</span>
              <span class="font-medium">{{ playbook.trigger }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Usage (30d):</span>
              <span class="font-medium">{{ playbook.usageCount }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Success Rate:</span>
              <span class="font-medium text-green-600"
                >{{ playbook.successRate }}%</span
              >
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Last Updated:</span>
              <span class="font-medium">{{
                formatDate(playbook.updatedAt)
              }}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Playbooks Table View -->
    <Card v-else>
      <CardHeader>
        <h3 class="text-lg font-medium">Playbooks</h3>
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b">
                <th class="text-left py-3 px-4 font-medium">Name</th>
                <th class="text-left py-3 px-4 font-medium">Category</th>
                <th class="text-left py-3 px-4 font-medium">Trigger</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Usage (30d)</th>
                <th class="text-left py-3 px-4 font-medium">Success Rate</th>
                <th class="text-left py-3 px-4 font-medium">Updated</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="playbook in filteredPlaybooks"
                :key="playbook.id"
                class="border-b hover:bg-muted/50 cursor-pointer"
                @click="editPlaybook(playbook.id)"
              >
                <td class="py-3 px-4">
                  <div>
                    <div class="font-medium">{{ playbook.name }}</div>
                    <div class="text-sm text-muted-foreground">
                      {{ playbook.description }}
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4">
                  <Badge variant="outline">{{
                    getCategoryLabel(playbook.category)
                  }}</Badge>
                </td>
                <td class="py-3 px-4 text-sm">{{ playbook.trigger }}</td>
                <td class="py-3 px-4">
                  <Badge :variant="getStatusVariant(playbook.status)">
                    {{ playbook.status }}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-sm">{{ playbook.usageCount }}</td>
                <td class="py-3 px-4 text-sm text-green-600">
                  {{ playbook.successRate }}%
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ formatDate(playbook.updatedAt) }}
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      @click.stop="duplicatePlaybook(playbook.id)"
                    >
                      <Copy class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      @click.stop="deletePlaybook(playbook.id)"
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  Plus,
  Book,
  Play,
  Target,
  Zap,
  Search,
  Filter,
  LayoutGrid,
  List,
  MoreHorizontal,
  Copy,
  Trash2,
  FileText,
} from "lucide-vue-next";

// TODO: Import actual Badge component when available
const Badge = ({ variant = "default", ...props }) =>
  h("span", {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === "outline"
        ? "border border-gray-300 text-gray-700"
        : variant === "secondary"
        ? "bg-blue-100 text-blue-800"
        : variant === "destructive"
        ? "bg-red-100 text-red-800"
        : variant === "success"
        ? "bg-green-100 text-green-800"
        : "bg-gray-100 text-gray-800"
    }`,
    ...props,
  });

// Reactive state
const loading = ref(true);
const searchQuery = ref("");
const selectedCategory = ref("");
const selectedStatus = ref("");
const viewMode = ref<"grid" | "table">("grid");

// Mock data - TODO: Replace with actual API calls
const stats = ref({
  total: 24,
  active: 18,
  avgSuccessRate: 87,
  totalTriggers: 1248,
  newThisMonth: 3,
});

const playbooks = ref([
  {
    id: "1",
    name: "Billing Issue Resolution",
    description:
      "Automated flow for common billing questions and payment issues",
    category: "customer-support",
    status: "active",
    trigger: "billing, payment, invoice",
    usageCount: 145,
    successRate: 92,
    updatedAt: new Date("2024-01-15"),
    createdAt: new Date("2024-01-01"),
  },
  {
    id: "2",
    name: "Product Demo Request",
    description:
      "Captures lead information and schedules product demonstrations",
    category: "sales",
    status: "active",
    trigger: "demo, trial, see product",
    usageCount: 89,
    successRate: 78,
    updatedAt: new Date("2024-01-14"),
    createdAt: new Date("2024-01-02"),
  },
  {
    id: "3",
    name: "Password Reset Help",
    description: "Guides users through password reset process",
    category: "technical",
    status: "active",
    trigger: "password, forgot, reset",
    usageCount: 234,
    successRate: 95,
    updatedAt: new Date("2024-01-13"),
    createdAt: new Date("2024-01-03"),
  },
  {
    id: "4",
    name: "Feature Request Collection",
    description: "Collects and categorizes feature requests from users",
    category: "custom",
    status: "draft",
    trigger: "feature, request, suggestion",
    usageCount: 12,
    successRate: 85,
    updatedAt: new Date("2024-01-12"),
    createdAt: new Date("2024-01-10"),
  },
  {
    id: "5",
    name: "Refund Process",
    description: "Handles refund requests and initiates return process",
    category: "customer-support",
    status: "inactive",
    trigger: "refund, return, money back",
    usageCount: 67,
    successRate: 88,
    updatedAt: new Date("2024-01-11"),
    createdAt: new Date("2024-01-05"),
  },
]);

// Computed properties
const filteredPlaybooks = computed(() => {
  return playbooks.value.filter((playbook) => {
    const matchesSearch =
      !searchQuery.value ||
      playbook.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      playbook.description
        .toLowerCase()
        .includes(searchQuery.value.toLowerCase()) ||
      playbook.trigger.toLowerCase().includes(searchQuery.value.toLowerCase());

    const matchesCategory =
      !selectedCategory.value || playbook.category === selectedCategory.value;
    const matchesStatus =
      !selectedStatus.value || playbook.status === selectedStatus.value;

    return matchesSearch && matchesCategory && matchesStatus;
  });
});

// Methods
const getCategoryLabel = (category: string) => {
  const labels = {
    "customer-support": "Customer Support",
    sales: "Sales",
    technical: "Technical",
    custom: "Custom",
  };
  return labels[category as keyof typeof labels] || category;
};

const getStatusVariant = (status: string) => {
  const variants = {
    active: "success",
    inactive: "secondary",
    draft: "outline",
  };
  return variants[status as keyof typeof variants] || "default";
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
};

const toggleView = () => {
  viewMode.value = viewMode.value === "grid" ? "table" : "grid";
};

const createPlaybook = () => {
  // TODO: Navigate to playbook creation
  navigateTo("/playbooks/new");
};

const editPlaybook = (id: string) => {
  // TODO: Navigate to playbook editor
  navigateTo(`/playbooks/${id}/edit`);
};

const duplicatePlaybook = (id: string) => {
  // TODO: Implement playbook duplication
  console.log("Duplicate playbook:", id);
};

const deletePlaybook = (id: string) => {
  // TODO: Implement playbook deletion with confirmation
  console.log("Delete playbook:", id);
};

const togglePlaybookStatus = (id: string) => {
  // TODO: Toggle playbook active/inactive status
  console.log("Toggle status for playbook:", id);
};

// Lifecycle
onMounted(async () => {
  // TODO: Fetch playbooks from API
  // await fetchPlaybooks()
  // await fetchStats()

  // Simulate loading
  setTimeout(() => {
    loading.value = false;
  }, 1000);
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Playbooks - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage automated conversation flows and responses",
    },
  ],
});
</script>
