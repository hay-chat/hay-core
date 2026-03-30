<template>
  <Page :title="t('page.title')" :description="t('page.description')">
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="icon" @click="router.push('/playbooks/new')">
          <Plus class="h-4 w-4" />
        </Button>
        <Button @click="router.push('/playbooks/wizard')">
          <Sparkles class="h-4 w-4 mr-2" />
          {{ t("actions.generatePlaybook") }}
        </Button>
      </div>
    </template>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <MetricCard
        :title="t('stats.totalPlaybooks')"
        :metric="stats.total"
        :subtitle="t('stats.newThisMonth', { count: stats.newThisMonth })"
        :icon="Book"
      />
      <MetricCard
        :title="t('stats.active')"
        :metric="stats.active"
        :subtitle="
          t('stats.percentOfTotal', {
            percent: stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0,
          })
        "
        :icon="Play"
      />
      <MetricCard
        :title="t('stats.totalTriggers')"
        :metric="stats.totalTriggers"
        :subtitle="t('stats.last30Days')"
        :icon="Zap"
      />
    </div>

    <!-- Filters and Search -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="relative">
          <Input
            v-model="searchQuery"
            :placeholder="t('filters.searchPlaceholder')"
            class="pl-8 min-w-[300px]"
            :icon-start="Search"
          />
        </div>

        <Input
          v-model="selectedCategory"
          type="select"
          :placeholder="t('filters.allCategories')"
          :options="[
            { label: t('filters.allCategories'), value: '' },
            { label: t('filters.customerSupport'), value: 'customer-support' },
            { label: t('filters.sales'), value: 'sales' },
            { label: t('filters.technical'), value: 'technical' },
            { label: t('filters.custom'), value: 'custom' },
          ]"
        />

        <Input
          v-model="selectedStatus"
          type="select"
          :placeholder="t('filters.allStatus')"
          :options="[
            { label: t('filters.allStatus'), value: '' },
            { label: t('filters.statusActive'), value: 'active' },
            { label: t('filters.statusArchived'), value: 'archived' },
            { label: t('filters.statusDraft'), value: 'draft' },
          ]"
        />
      </div>

      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="toggleView">
          <LayoutGrid v-if="viewMode === 'table'" class="h-4 w-4" />
          <List v-else class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
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
    <EmptyState
      v-else-if="filteredPlaybooks.length === 0"
      :title="searchQuery ? t('empty.noPlaybooksFound') : t('empty.noPlaybooksCreated')"
      :description="searchQuery ? t('empty.adjustSearch') : t('empty.createFirst')"
      illustration="/bale/playbook.svg"
      :action="searchQuery ? undefined : t('actions.createFirstPlaybook')"
      @click="router.push('/playbooks/new')"
    />

    <!-- Playbooks Grid View -->
    <div v-else-if="viewMode === 'grid'" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                <Badge :variant="getStatusVariant(playbook.status || 'draft')">
                  {{ getStatusLabel(playbook.status || "draft") }}
                </Badge>
              </div>
              <h3 class="font-semibold">
                {{ playbook.title }}
              </h3>
              <p class="text-sm text-neutral-muted">
                {{ playbook.description }}
              </p>
            </div>
            <Button variant="ghost" size="sm" @click.stop="togglePlaybookStatus(playbook.id)">
              <MoreHorizontal class="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-neutral-muted">{{ t("table.agents") }}:</span>
              <span class="font-medium">{{ playbook.agents?.length || 0 }}</span>
            </div>
            <div v-if="playbook.created_at" class="flex items-center justify-between text-sm">
              <span class="text-neutral-muted">{{ t("table.created") }}:</span>
              <span class="font-medium">{{ formatDateTime(new Date(playbook.created_at)) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Playbooks Table View -->
    <Card v-else>
      <CardHeader>
        <h3 class="text-lg font-medium">{{ t("table.playbooks") }}</h3>
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b">
                <th class="text-left py-3 px-4 font-medium">{{ t("table.name") }}</th>
                <th class="text-left py-3 px-4 font-medium">{{ t("table.agents") }}</th>
                <th class="text-left py-3 px-4 font-medium">{{ t("table.status") }}</th>
                <th class="text-left py-3 px-4 font-medium">{{ t("table.created") }}</th>
                <th class="text-left py-3 px-4 font-medium">{{ t("table.actions") }}</th>
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
                    <div class="font-medium">
                      {{ playbook.title }}
                    </div>
                    <div class="text-sm text-neutral-muted">
                      {{ playbook.description }}
                    </div>
                  </div>
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ t("table.agentsCount", { count: playbook.agents?.length || 0 }) }}
                </td>
                <td class="py-3 px-4">
                  <Badge :variant="getStatusVariant(playbook.status || 'draft')">
                    {{ getStatusLabel(playbook.status || "draft") }}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-sm">
                  {{ playbook.created_at ? formatDateTime(new Date(playbook.created_at)) : "-" }}
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" @click.stop="duplicatePlaybook(playbook.id)">
                      <Copy class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" @click.stop="deletePlaybook(playbook.id)">
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
      :confirm-text="$t('common.delete')"
      :destructive="true"
      @confirm="confirmDelete"
    />
  </Page>
</template>

<script setup lang="ts">
import {
  Plus,
  Book,
  Play,
  Zap,
  Search,
  LayoutGrid,
  List,
  MoreHorizontal,
  Copy,
  Trash2,
  Sparkles,
} from "lucide-vue-next";

import { useRouter } from "vue-router";
import { useToast } from "~/composables/useToast";
import type { Playbook } from "~/types/playbook";
import { HayApi } from "@/utils/api";
import DataPagination from "@/components/DataPagination.vue";
import MetricCard from "@/components/MetricCard.vue";

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

// Reactive state
const loading = ref(true);
const searchQuery = ref("");
const selectedCategory = ref("");
const selectedStatus = ref("");
const viewMode = ref<"grid" | "table">("grid");
const currentPage = ref(1);
const pageSize = ref(10);

// Data from API
const playbooks = ref<Playbook[]>([]);

// Stats computed from playbooks
const stats = computed(() => {
  const total = playbooks.value.length;
  const active = playbooks.value.filter((p) => p.status === "active").length;
  const _draft = playbooks.value.filter((p) => p.status === "draft").length;

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
        playbook.description.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
      (playbook.trigger &&
        playbook.trigger.toLowerCase().includes(searchQuery.value.toLowerCase()));

    const matchesStatus = !selectedStatus.value || playbook.status === selectedStatus.value;

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
const totalPages = computed(() => Math.ceil(filteredPlaybooks.value.length / pageSize.value));

// Methods
const _getCategoryLabel = (category: string) => {
  const labels = {
    "customer-support": "Customer Support",
    sales: "Sales",
    technical: "Technical",
    custom: "Custom",
  };
  return labels[category as keyof typeof labels] || category;
};

const getStatusVariant = (
  status: string,
): "default" | "destructive" | "outline" | "secondary" | "success" => {
  const variants: Record<string, "default" | "destructive" | "outline" | "secondary" | "success"> =
    {
      active: "success",
      archived: "secondary",
      draft: "outline",
    };
  return variants[status as keyof typeof variants] || "default";
};

const getStatusLabel = (status: string): string => {
  const key = `filters.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  return t(key);
};

const toggleView = () => {
  viewMode.value = viewMode.value === "grid" ? "table" : "grid";
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
const playbookToDelete = ref<Playbook | null>(null);
const deleteDialogTitle = ref(t("delete.title"));
const deleteDialogDescription = ref("");

const deletePlaybook = (id: string) => {
  const playbook = playbooks.value.find((p) => p.id === id);
  if (!playbook) return;

  playbookToDelete.value = playbook;
  deleteDialogDescription.value = t("delete.confirmMessage", { name: playbook.title });
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!playbookToDelete.value) return;

  try {
    await HayApi.playbooks.delete.mutate({ id: playbookToDelete.value.id });

    // Remove from local list
    playbooks.value = playbooks.value.filter((p) => p.id !== playbookToDelete.value!.id);

    toast.success(t("toast.deleteSuccess"));
  } catch (error) {
    console.error("Failed to delete playbook:", error);
    toast.error(t("toast.deleteFailed"));
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
    // Type assertion to ensure compatibility
    playbooks.value = (response || []) as Playbook[];
  } catch (error) {
    console.error("Failed to fetch playbooks:", error);
    toast.error(t("toast.loadFailed"));
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
  title: t("page.headTitle"),
  meta: [
    {
      name: "description",
      content: t("page.description"),
    },
  ],
});
</script>
