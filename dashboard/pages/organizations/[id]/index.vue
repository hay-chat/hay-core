<template>
  <div v-if="organization" class="space-y-8">
    <!-- Organization Header -->
    <div class="bg-background border rounded-lg p-6">
      <div
        class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
      >
        <div class="flex items-start space-x-4">
          <div
            class="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center"
          >
            <Building2 class="h-8 w-8 text-primary" />
          </div>
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <h1 class="text-2xl font-bold text-foreground">
                {{ organization.name }}
              </h1>
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  organization.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : organization.status === 'inactive'
                    ? 'bg-gray-100 text-gray-800'
                    : 'bg-red-100 text-red-800',
                ]"
              >
                {{ organization.status }}
              </div>
            </div>
            <p class="mt-2 text-muted-foreground">
              {{ organization.description }}
            </p>
            <div
              class="mt-3 flex items-center space-x-4 text-sm text-muted-foreground"
            >
              <span>Created {{ formatDate(organization.createdAt) }}</span>
              <span>•</span>
              <span>{{ organization.memberCount }} members</span>
              <span>•</span>
              <span>{{ organization.agentCount }} agents</span>
            </div>
          </div>
        </div>
        <div class="flex space-x-3">
          <Button variant="outline" @click="editOrganization">
            <Settings class="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            v-if="organization.id !== currentOrganization?.id"
            @click="switchToOrganization"
          >
            <Building2 class="mr-2 h-4 w-4" />
            Switch To
          </Button>
        </div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="border-b">
      <nav class="-mb-px flex space-x-8">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="[
            'py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap',
            activeTab === tab.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground',
          ]"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="mr-2 h-4 w-4 inline" />
          {{ tab.name }}
        </button>
      </nav>
    </div>

    <!-- Tab Content -->
    <div class="space-y-6">
      <!-- Overview Tab -->
      <div v-if="activeTab === 'overview'" class="space-y-6">
        <!-- Key Metrics -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm font-medium">Total Members</CardTitle>
              <Users class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.memberCount }}
              </div>
              <p class="text-xs text-muted-foreground">
                <span class="text-green-600">+2</span> this month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm font-medium">Active Agents</CardTitle>
              <Bot class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.agentCount }}
              </div>
              <p class="text-xs text-muted-foreground">
                <span class="text-green-600">+1</span> this week
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm font-medium">Conversations</CardTitle>
              <MessageSquare class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.totalConversations }}
              </div>
              <p class="text-xs text-muted-foreground">
                <span class="text-green-600">+12%</span> from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm font-medium">Storage Used</CardTitle>
              <HardDrive class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.storageUsed }}GB
              </div>
              <p class="text-xs text-muted-foreground">
                of {{ organization.storageLimit }}GB limit
              </p>
            </CardContent>
          </Card>
        </div>

        <!-- Recent Activity and Resource Usage -->
        <div class="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription
                >Latest updates in this organization</CardDescription
              >
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div
                  v-for="activity in recentActivity"
                  :key="activity.id"
                  class="flex items-start space-x-3"
                >
                  <div class="flex-shrink-0">
                    <component
                      :is="activity.icon"
                      :class="[
                        'h-5 w-5',
                        activity.type === 'success'
                          ? 'text-green-500'
                          : activity.type === 'warning'
                          ? 'text-yellow-500'
                          : activity.type === 'error'
                          ? 'text-red-500'
                          : 'text-blue-500',
                      ]"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-foreground">
                      {{ activity.title }}
                    </p>
                    <p class="text-sm text-muted-foreground">
                      {{ activity.description }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-1">
                      {{ formatTimeAgo(activity.timestamp) }}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resource Usage</CardTitle>
              <CardDescription>Current month usage overview</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>API Calls</span>
                    <span
                      >{{ organization.apiCalls.toLocaleString() }} /
                      {{ organization.apiLimit.toLocaleString() }}</span
                    >
                  </div>
                  <div class="mt-2 bg-muted rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${
                          (organization.apiCalls / organization.apiLimit) * 100
                        }%`,
                      }"
                    ></div>
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>Storage</span>
                    <span
                      >{{ organization.storageUsed }}GB /
                      {{ organization.storageLimit }}GB</span
                    >
                  </div>
                  <div class="mt-2 bg-muted rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${
                          (organization.storageUsed /
                            organization.storageLimit) *
                          100
                        }%`,
                      }"
                    ></div>
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>Active Agents</span>
                    <span
                      >{{ organization.agentCount }} /
                      {{ organization.agentLimit }}</span
                    >
                  </div>
                  <div class="mt-2 bg-muted rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${
                          (organization.agentCount / organization.agentLimit) *
                          100
                        }%`,
                      }"
                    ></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <!-- Members Tab -->
      <div v-if="activeTab === 'members'" class="space-y-6">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-lg font-medium text-foreground">
              Organization Members
            </h3>
            <p class="text-sm text-muted-foreground">
              Manage who has access to this organization
            </p>
          </div>
          <Button @click="inviteMember">
            <UserPlus class="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        </div>

        <Card>
          <CardContent class="p-0">
            <div class="divide-y">
              <div
                v-for="member in members"
                :key="member.id"
                class="p-6 flex items-center justify-between"
              >
                <div class="flex items-center space-x-3">
                  <div
                    class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"
                  >
                    <User class="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p class="font-medium text-foreground">{{ member.name }}</p>
                    <p class="text-sm text-muted-foreground">
                      {{ member.email }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center space-x-3">
                  <div class="text-sm">
                    <select
                      v-model="member.role"
                      class="px-3 py-1 border border-input bg-background rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      @change="updateMemberRole(member)"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    @click="removeMember(member)"
                  >
                    <X class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Settings Tab -->
      <div v-if="activeTab === 'settings'" class="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription
              >Basic organization information and preferences</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                v-model="organizationForm.name"
                placeholder="Enter organization name"
              />
            </div>
            <div>
              <Label htmlFor="orgDescription">Description</Label>
              <Input
                id="orgDescription"
                v-model="organizationForm.description"
                placeholder="Enter description"
              />
            </div>
            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                v-model="organizationForm.timezone"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
              </select>
            </div>
            <div class="flex justify-end">
              <Button @click="saveSettings">Save Changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription
              >Configure security policies for this
              organization</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">Two-Factor Authentication</p>
                <p class="text-sm text-muted-foreground">
                  Require 2FA for all members
                </p>
              </div>
              <Checkbox v-model:checked="organizationForm.require2FA" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">SSO Integration</p>
                <p class="text-sm text-muted-foreground">
                  Enable single sign-on
                </p>
              </div>
              <Checkbox v-model:checked="organizationForm.ssoEnabled" />
            </div>
            <div class="flex justify-end">
              <Button @click="saveSecuritySettings"
                >Save Security Settings</Button
              >
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
            <CardDescription
              >Manage API keys for this organization</CardDescription
            >
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <div>
                  <h4 class="font-medium">Primary API Key</h4>
                  <p class="text-sm text-muted-foreground">
                    Used for API access
                  </p>
                </div>
                <div class="flex space-x-2">
                  <Button variant="outline" size="sm" @click="regenerateApiKey">
                    <RefreshCw class="mr-2 h-4 w-4" />
                    Regenerate
                  </Button>
                  <Button variant="outline" size="sm" @click="copyApiKey">
                    <Copy class="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </div>
              <div class="bg-muted p-3 rounded font-mono text-sm">
                {{ organization.apiKey }}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>

  <!-- Loading State -->
  <div v-else-if="loading" class="space-y-8">
    <div class="bg-background border rounded-lg p-6">
      <div class="flex items-start space-x-4">
        <div class="h-16 w-16 bg-muted rounded-lg animate-pulse"></div>
        <div class="flex-1 space-y-2">
          <div class="h-6 bg-muted rounded w-1/3 animate-pulse"></div>
          <div class="h-4 bg-muted rounded w-2/3 animate-pulse"></div>
          <div class="h-3 bg-muted rounded w-1/2 animate-pulse"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Error State -->
  <div v-else class="text-center py-12">
    <AlertCircle class="mx-auto h-12 w-12 text-red-500" />
    <h3 class="mt-4 text-lg font-medium text-foreground">
      Organization not found
    </h3>
    <p class="mt-2 text-sm text-muted-foreground">
      The organization you're looking for doesn't exist or you don't have
      permission to view it.
    </p>
    <div class="mt-6">
      <Button @click="router.push('/organizations')">
        Back to Organizations
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Building2,
  Settings,
  Users,
  Bot,
  MessageSquare,
  HardDrive,
  User,
  UserPlus,
  X,
  RefreshCw,
  Copy,
  AlertCircle,
  BarChart3,
  Key,
} from "lucide-vue-next";

const router = useRouter();

// TODO: Import organization store/composable
// TODO: Import router params

definePageMeta({
  // TODO: Add authentication middleware
  // // middleware: 'auth'
});

// Get organization ID from route
const route = useRoute();
const organizationId = route.params["id"] as string;

// State
const loading = ref(true);
const activeTab = ref("overview");

// Mock current organization - TODO: Get from store
const currentOrganization = ref({
  id: "1",
  name: "Acme Corp",
});

// Organization form
const organizationForm = reactive({
  name: "",
  description: "",
  timezone: "UTC",
  require2FA: false,
  ssoEnabled: false,
});

// Tab configuration
const tabs = [
  { id: "overview", name: "Overview", icon: BarChart3 },
  { id: "members", name: "Members", icon: Users },
  { id: "settings", name: "Settings", icon: Settings },
];

// Mock organization data - TODO: Replace with real API calls
const organization = ref(null as any);
const members = ref([
  {
    id: "1",
    name: "John Doe",
    email: "john@acme.com",
    role: "admin",
    joinedAt: new Date("2023-01-15"),
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane@acme.com",
    role: "member",
    joinedAt: new Date("2023-02-10"),
  },
  {
    id: "3",
    name: "Bob Wilson",
    email: "bob@acme.com",
    role: "viewer",
    joinedAt: new Date("2023-03-05"),
  },
]);

const recentActivity = ref([
  {
    id: 1,
    type: "success",
    icon: UserPlus,
    title: "New member added",
    description: "Jane Smith joined the organization",
    timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
  },
  {
    id: 2,
    type: "info",
    icon: Bot,
    title: "Agent updated",
    description: "Customer Support Bot configuration was modified",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
  },
  {
    id: 3,
    type: "success",
    icon: Key,
    title: "API key regenerated",
    description: "Primary API key was regenerated for security",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8), // 8 hours ago
  },
]);

// Methods
const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

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

const loadOrganization = async () => {
  loading.value = true;
  try {
    // TODO: Fetch organization data from API
    console.log("Loading organization:", organizationId);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Mock organization data
    organization.value = {
      id: organizationId,
      name: "Acme Corp",
      description:
        "Main business organization for customer support and sales automation",
      status: "active",
      memberCount: 12,
      agentCount: 8,
      totalConversations: 15420,
      storageUsed: 2.4,
      storageLimit: 10,
      apiCalls: 12500,
      apiLimit: 50000,
      agentLimit: 25,
      createdAt: new Date("2023-01-15"),
      apiKey: "hk_1234567890abcdef...",
    };

    // Initialize form with organization data
    organizationForm.name = organization.value.name;
    organizationForm.description = organization.value.description;
  } catch (error) {
    console.error("Error loading organization:", error);
    // TODO: Show error notification
  } finally {
    loading.value = false;
  }
};

const editOrganization = () => {
  // TODO: Switch to edit mode or open edit modal
  console.log("Edit organization");
};

const switchToOrganization = async () => {
  try {
    // TODO: Implement organization switching logic
    console.log("Switch to organization:", organizationId);

    // TODO: Update current organization in store
    // TODO: Show success notification
    // TODO: Redirect to dashboard
  } catch (error) {
    console.error("Error switching organization:", error);
    // TODO: Show error notification
  }
};

const inviteMember = () => {
  // TODO: Open invite member modal
  console.log("Invite member");
};

const updateMemberRole = async (member: any) => {
  try {
    // TODO: Update member role via API
    console.log("Update member role:", member.id, member.role);

    // TODO: Show success notification
  } catch (error) {
    console.error("Error updating member role:", error);
    // TODO: Show error notification
  }
};

const removeMember = async (member: any) => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Remove member via API
    console.log("Remove member:", member.id);

    // TODO: Update members list
    // TODO: Show success notification
  } catch (error) {
    console.error("Error removing member:", error);
    // TODO: Show error notification
  }
};

const saveSettings = async () => {
  try {
    // TODO: Save organization settings via API
    console.log("Save settings:", organizationForm);

    // TODO: Update organization data
    // TODO: Show success notification
  } catch (error) {
    console.error("Error saving settings:", error);
    // TODO: Show error notification
  }
};

const saveSecuritySettings = async () => {
  try {
    // TODO: Save security settings via API
    console.log("Save security settings");

    // TODO: Show success notification
  } catch (error) {
    console.error("Error saving security settings:", error);
    // TODO: Show error notification
  }
};

const regenerateApiKey = async () => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Regenerate API key via API
    console.log("Regenerate API key");

    // TODO: Update organization data with new key
    // TODO: Show success notification
  } catch (error) {
    console.error("Error regenerating API key:", error);
    // TODO: Show error notification
  }
};

const copyApiKey = async () => {
  try {
    await navigator.clipboard.writeText(organization.value.apiKey);
    // TODO: Show success notification
    console.log("API key copied to clipboard");
  } catch (error) {
    console.error("Error copying API key:", error);
    // TODO: Show error notification
  }
};

// Lifecycle
onMounted(async () => {
  await loadOrganization();
});

// TODO: Add real-time updates for organization data
// TODO: Implement proper error handling
// TODO: Add accessibility improvements
// TODO: Add keyboard shortcuts

// SEO
useHead({
  title: computed(() =>
    organization.value
      ? `${organization.value.name} - Hay Dashboard`
      : "Organization - Hay Dashboard"
  ),
  meta: [
    {
      name: "description",
      content: "Manage organization settings, members, and configuration",
    },
  ],
});
</script>
