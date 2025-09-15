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
      <MetricCard
        title="Total Playbooks"
        :metric="stats.total"
        :subtitle="`+${stats.newThisMonth} this month`"
        :icon="Book"
      />
      <MetricCard
        title="Active"
        :metric="stats.active"
        :subtitle="`${
          stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0
        }% of total`"
        :icon="Play"
      />
      <MetricCard
        title="Avg Success Rate"
        :metric="`${stats.avgSuccessRate}%`"
        subtitle="+2.1% from last month"
        subtitle-color="green"
        :icon="Target"
      />
      <MetricCard
        title="Total Triggers"
        :metric="stats.totalTriggers"
        subtitle="Last 30 days"
        :icon="Zap"
      />
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
          <option value="archived">Archived</option>
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
        v-for="playbook in paginatedPlaybooks"
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
              </div>
              <h3 class="font-semibold">{{ playbook.title }}</h3>
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
              <span class="text-muted-foreground">Agents:</span>
              <span class="font-medium">{{
                playbook.agents?.length || 0
              }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Created:</span>
              <span class="font-medium">{{
                formatDate(new Date(playbook.created_at))
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
                <th class="text-left py-3 px-4 font-medium">Agents</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Created</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="playbook in paginatedPlaybooks"
                :key="playbook.id"
                class="border-b hover:bg-background-secondary cursor-pointer"
                @click="editPlaybook(playbook.id)"
              >
                <td class="py-3 px-4">
                  <div>
                    <div class="font-medium">{{ playbook.title }}</div>
                    <div class="text-sm text-muted-foreground">
                      {{ playbook.description }}
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ playbook.agents?.length || 0 }} agents
                </td>
                <td class="py-3 px-4">
                  <Badge :variant="getStatusVariant(playbook.status)">
                    {{ playbook.status }}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ formatDate(new Date(playbook.created_at)) }}
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

    <!-- Pagination -->
    <DataPagination
      v-if="!loading && filteredPlaybooks.length > 0"
      :current-page="currentPage"
      :total-pages="totalPages"
      :items-per-page="pageSize"
      :total-items="filteredPlaybooks.length"
      @page-change="handlePageChange"
      @items-per-page-change="handleItemsPerPageChange"
    />

    <!-- Delete Confirmation Dialog -->
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

import { useRouter } from "vue-router";
import { useToast } from "~/composables/useToast";
import type { Playbook } from "~/types/playbook";
import { HayApi } from "@/utils/api";
import DataPagination from "@/components/DataPagination.vue";
import MetricCard from "@/components/MetricCard.vue";

const toast = useToast();
const router = useRouter();

// Reactive state
const loading = ref(true);
const searchQuery = ref("");
const selectedCategory = ref("");
const selectedStatus = ref("");
const viewMode = ref<"grid" | "table">("grid");
const currentPage = ref(1);
const pageSize = ref(10);

// Data from API
const playbooks = ref<any[]>([]);

// Stats computed from playbooks
const stats = computed(() => {
  const total = playbooks.value.length;
  const active = playbooks.value.filter((p) => p.status === "active").length;
  const draft = playbooks.value.filter((p) => p.status === "draft").length;

  return {
    total,
    active,
    avgSuccessRate: 0, // This would need to be calculated from actual usage data
    totalTriggers: 0, // This would need to be calculated from actual usage data
    newThisMonth: 0, // This would need to be calculated based on created_at dates
  };
});

// Computed properties
const filteredPlaybooks = computed(() => {
  return playbooks.value.filter((playbook) => {
    const matchesSearch =
      !searchQuery.value ||
      playbook.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      (playbook.description &&
        playbook.description
          .toLowerCase()
          .includes(searchQuery.value.toLowerCase())) ||
      (playbook.trigger &&
        playbook.trigger
          .toLowerCase()
          .includes(searchQuery.value.toLowerCase()));

    const matchesStatus =
      !selectedStatus.value || playbook.status === selectedStatus.value;

    return matchesSearch && matchesStatus;
  });
});

// Paginated playbooks
const paginatedPlaybooks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredPlaybooks.value.slice(start, end);
});

// Total pages
const totalPages = computed(() =>
  Math.ceil(filteredPlaybooks.value.length / pageSize.value)
);

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
    archived: "secondary",
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
  router.push("/playbooks/new");
};

const editPlaybook = (id: string) => {
  router.push(`/playbooks/${id}`);
};

const duplicatePlaybook = (id: string) => {
  // TODO: Implement playbook duplication
  console.log("Duplicate playbook:", id);
};

// Delete dialog state
const showDeleteDialog = ref(false);
const playbookToDelete = ref<any>(null);
const deleteDialogTitle = ref("Delete Playbook");
const deleteDialogDescription = ref("");

const deletePlaybook = (id: string) => {
  const playbook = playbooks.value.find((p) => p.id === id);
  if (!playbook) return;

  playbookToDelete.value = playbook;
  deleteDialogDescription.value = `Are you sure you want to delete "${playbook.title}"? This action cannot be undone.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!playbookToDelete.value) return;

  try {
    await HayApi.playbooks.delete.mutate({ id: playbookToDelete.value.id });

    // Remove from local list
    playbooks.value = playbooks.value.filter(
      (p) => p.id !== playbookToDelete.value!.id
    );

    toast.success("Playbook deleted successfully");
  } catch (error) {
    console.error("Failed to delete playbook:", error);
    toast.error("Failed to delete playbook");
  } finally {
    playbookToDelete.value = null;
    showDeleteDialog.value = false;
  }
};

const togglePlaybookStatus = (id: string) => {
  // TODO: Toggle playbook active/inactive status
  console.log("Toggle status for playbook:", id);
};

// Fetch playbooks from API
const fetchPlaybooks = async () => {
  try {
    loading.value = true;
    const response = await HayApi.playbooks.list.query();
    playbooks.value = response || [];
  } catch (error) {
    console.error("Failed to fetch playbooks:", error);
    toast.error("Failed to load playbooks");
  } finally {
    loading.value = false;
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
  await fetchPlaybooks();
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
