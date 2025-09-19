<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Organizations</h1>
        <p class="mt-1 text-sm text-neutral-muted">
          Manage your organizations and switch between different workspaces.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
        <Button @click="createOrganization">
          <Plus class="mr-2 h-4 w-4" />
          Create Organization
        </Button>
      </div>
    </div>

    <!-- Search and Filter -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-muted"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search organizations..."
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
          <option value="suspended">Suspended</option>
        </select>
      </div>
    </div>

    <!-- Organizations Grid -->
    <div
      v-if="!loading && filteredOrganizations.length > 0"
      class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      <Card
        v-for="org in filteredOrganizations"
        :key="org.id"
        class="hover:shadow-md transition-shadow cursor-pointer"
        @click="viewOrganization(org.id)"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <div class="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 class="h-6 w-6 text-primary" />
              </div>
              <div class="flex-1">
                <CardTitle class="text-lg">
                  {{ org.name }}
                </CardTitle>
                <CardDescription class="mt-1">
                  {{ org.description || "No description" }}
                </CardDescription>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  org.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : org.status === 'inactive'
                      ? 'bg-gray-100 text-gray-800'
                      : 'bg-red-100 text-red-800',
                ]"
              >
                {{ org.status }}
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 p-0"
                @click.stop="showOptionsMenu(org)"
              >
                <MoreVertical class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <!-- Organization Stats -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p class="text-neutral-muted">Members</p>
                <p class="font-medium">
                  {{ org.memberCount }}
                </p>
              </div>
              <div>
                <p class="text-neutral-muted">Agents</p>
                <p class="font-medium">
                  {{ org.agentCount }}
                </p>
              </div>
            </div>

            <!-- Recent Activity -->
            <div class="pt-2 border-t">
              <p class="text-xs text-neutral-muted">
                Last activity: {{ formatTimeAgo(org.lastActivity) }}
              </p>
              <p class="text-xs text-neutral-muted mt-1">
                Created: {{ formatDate(org.createdAt) }}
              </p>
            </div>

            <!-- Quick Actions -->
            <div class="flex space-x-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                :disabled="org.id === currentOrganization?.id"
                @click.stop="switchToOrganization(org.id)"
              >
                <Building2 class="mr-1 h-3 w-3" />
                {{ org.id === currentOrganization?.id ? "Current" : "Switch" }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                @click.stop="viewOrganization(org.id)"
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
    <div v-else-if="!loading && filteredOrganizations.length === 0" class="text-center py-12">
      <Building2 class="mx-auto h-12 w-12 text-neutral-muted" />
      <h3 class="mt-4 text-lg font-medium text-foreground">
        {{ searchQuery || statusFilter ? "No organizations found" : "No organizations yet" }}
      </h3>
      <p class="mt-2 text-sm text-neutral-muted">
        {{
          searchQuery || statusFilter
            ? "Try adjusting your search or filters."
            : "Get started by creating your first organization."
        }}
      </p>
      <div class="mt-6">
        <Button @click="searchQuery || statusFilter ? clearFilters() : createOrganization()">
          {{ searchQuery || statusFilter ? "Clear Filters" : "Create Organization" }}
        </Button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="i in 6" :key="i" class="animate-pulse">
        <CardHeader>
          <div class="flex items-start space-x-3">
            <div class="h-12 w-12 bg-background-tertiary rounded-lg" />
            <div class="flex-1 space-y-2">
              <div class="h-4 bg-background-tertiary rounded w-3/4" />
              <div class="h-3 bg-background-tertiary rounded w-1/2" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-1">
                <div class="h-3 bg-background-tertiary rounded w-1/2" />
                <div class="h-4 bg-background-tertiary rounded w-3/4" />
              </div>
              <div class="space-y-1">
                <div class="h-3 bg-background-tertiary rounded w-1/2" />
                <div class="h-4 bg-background-tertiary rounded w-3/4" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Create Organization Modal -->
    <!-- TODO: Implement create organization modal component -->
  </div>
</template>

<script setup lang="ts">
import { Building2, Plus, RefreshCw, Search, Settings, MoreVertical } from "lucide-vue-next";

// TODO: Import organization store/composable
// TODO: Import router for navigation

definePageMeta({
  // TODO: Add authentication middleware
  // // middleware: 'auth'
});

// State
const loading = ref(false);
const searchQuery = ref("");
const statusFilter = ref("");

interface CurrentOrganization {
  id: string;
  name: string;
}

// Mock current organization - TODO: Get from store
const currentOrganization = ref<CurrentOrganization>({
  id: "1",
  name: "Acme Corp",
});

interface Organization {
  id: string;
  name: string;
  description: string;
  status: string;
  memberCount: number;
  agentCount: number;
  lastActivity: Date;
  createdAt: Date;
}

// Mock organizations data - TODO: Replace with real API calls
const organizations = ref<Organization[]>([
  {
    id: "1",
    name: "Acme Corp",
    description: "Main business organization",
    status: "active",
    memberCount: 12,
    agentCount: 8,
    lastActivity: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    createdAt: new Date("2023-01-15"),
  },
  {
    id: "2",
    name: "Customer Support Division",
    description: "Dedicated support team workspace",
    status: "active",
    memberCount: 6,
    agentCount: 15,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    createdAt: new Date("2023-03-22"),
  },
  {
    id: "3",
    name: "Sales Team",
    description: "Sales automation and lead management",
    status: "active",
    memberCount: 8,
    agentCount: 5,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 8), // 8 hours ago
    createdAt: new Date("2023-05-10"),
  },
  {
    id: "4",
    name: "Beta Testing Org",
    description: "Testing new features and integrations",
    status: "inactive",
    memberCount: 3,
    agentCount: 2,
    lastActivity: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), // 1 week ago
    createdAt: new Date("2023-07-01"),
  },
]);

// Computed
const filteredOrganizations = computed(() => {
  let filtered = organizations.value;

  // Apply search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (org) =>
        org.name.toLowerCase().includes(query) || org.description?.toLowerCase().includes(query),
    );
  }

  // Apply status filter
  if (statusFilter.value) {
    filtered = filtered.filter((org) => org.status === statusFilter.value);
  }

  return filtered;
});

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
    // TODO: Fetch organizations from API
    console.log("Refreshing organizations data...");

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Error refreshing data:", error);
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
  searchQuery.value = "";
  statusFilter.value = "";
};

const createOrganization = () => {
  // TODO: Open create organization modal or navigate to form
  // TODO: Implement organization creation workflow
  console.log("Create organization");
};

const viewOrganization = (id: string) => {
  // TODO: Navigate to organization detail page
  // await navigateTo(`/organizations/${id}`)
  console.log("View organization:", id);
};

const switchToOrganization = async (id: string) => {
  try {
    // TODO: Implement organization switching logic
    // TODO: Update current organization in store
    // TODO: Refresh user session with new organization context
    // TODO: Show success notification
    console.log("Switch to organization:", id);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Update current organization
    const org = organizations.value.find((o) => o.id === id);
    if (org) {
      currentOrganization.value = org;
    }
  } catch (error) {
    console.error("Error switching organization:", error);
    // TODO: Show error notification
  }
};

const showOptionsMenu = (org: Organization) => {
  // TODO: Show context menu with options like:
  // - Edit organization
  // - Manage members
  // - View settings
  // - Deactivate/Activate
  // - Delete (if allowed)
  console.log("Show options for organization:", org.id);
};

// Lifecycle
onMounted(async () => {
  // TODO: Load organizations on mount
  // TODO: Set up real-time updates for organization list
  console.log("Organizations page mounted");

  // Load data
  await refreshData();
});

// TODO: Add keyboard shortcuts for common actions
// TODO: Add bulk actions for organizations
// TODO: Implement organization creation modal
// TODO: Add organization invitation system
// TODO: Implement proper error handling
// TODO: Add accessibility improvements

// SEO
useHead({
  title: "Organizations - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage your organizations and workspaces",
    },
  ],
});
</script>
