<template>
  <div v-if="organization" class="space-y-8">
    <!-- Organization Header -->
    <div class="bg-background border rounded-lg p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div class="flex items-start space-x-4">
          <div class="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
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
            <p class="mt-2 text-neutral-muted">
              {{ organization.description }}
            </p>
            <div class="mt-3 flex items-center space-x-4 text-sm text-neutral-muted">
              <span>{{
                $t("organizations.header.created", { date: formatDateTime(organization.createdAt) })
              }}</span>
              <span>•</span>
              <span>{{
                $t("organizations.header.members", { count: organization.memberCount })
              }}</span>
              <span>•</span>
              <span>{{
                $t("organizations.header.agents", { count: organization.agentCount })
              }}</span>
            </div>
          </div>
        </div>
        <div class="flex space-x-3">
          <Button variant="outline" @click="editOrganization">
            <Settings class="mr-2 h-4 w-4" />
            {{ $t("organizations.header.edit") }}
          </Button>
          <Button v-if="organization.id !== currentOrganization?.id" @click="switchToOrganization">
            <Building2 class="mr-2 h-4 w-4" />
            {{ $t("organizations.header.switchTo") }}
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
              : 'border-transparent text-neutral-muted hover:text-foreground hover:border-neutral-muted',
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
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">
                {{ $t("organizations.overview.totalMembers") }}
              </CardTitle>
              <Users class="h-4 w-4 text-neutral-muted" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.memberCount }}
              </div>
              <p class="text-xs text-neutral-muted">
                <span class="text-green-600">{{
                  $t("organizations.overview.thisMonth", { count: 2 })
                }}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">
                {{ $t("organizations.overview.activeAgents") }}
              </CardTitle>
              <Bot class="h-4 w-4 text-neutral-muted" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.agentCount }}
              </div>
              <p class="text-xs text-neutral-muted">
                <span class="text-green-600">{{
                  $t("organizations.overview.thisWeek", { count: 1 })
                }}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">
                {{ $t("organizations.overview.conversations") }}
              </CardTitle>
              <MessageSquare class="h-4 w-4 text-neutral-muted" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">
                {{ organization.totalConversations }}
              </div>
              <p class="text-xs text-neutral-muted">
                <span class="text-green-600">{{
                  $t("organizations.overview.fromLastMonth", { percent: 12 })
                }}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle class="text-sm font-medium">
                {{ $t("organizations.overview.storageUsed") }}
              </CardTitle>
              <HardDrive class="h-4 w-4 text-neutral-muted" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">{{ organization.storageUsed }}GB</div>
              <p class="text-xs text-neutral-muted">
                {{ $t("organizations.overview.ofLimit", { limit: organization.storageLimit }) }}
              </p>
            </CardContent>
          </Card>
        </div>

        <!-- Recent Activity and Resource Usage -->
        <div class="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{{ $t("organizations.overview.recentActivity") }}</CardTitle>
              <CardDescription> {{ $t("organizations.overview.latestUpdates") }} </CardDescription>
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
                    <p class="text-sm text-neutral-muted">
                      {{ activity.description }}
                    </p>
                    <p class="text-xs text-neutral-muted mt-1">
                      {{ formatTimeAgo(activity.timestamp) }}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{{ $t("organizations.overview.resourceUsage") }}</CardTitle>
              <CardDescription>{{
                $t("organizations.overview.currentMonthUsage")
              }}</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>{{ $t("organizations.overview.apiCalls") }}</span>
                    <span
                      >{{ organization.apiCalls.toLocaleString() }} /
                      {{ organization.apiLimit.toLocaleString() }}</span
                    >
                  </div>
                  <div class="mt-2 bg-background-tertiary rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${(organization.apiCalls / organization.apiLimit) * 100}%`,
                      }"
                    />
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>{{ $t("organizations.overview.storage") }}</span>
                    <span
                      >{{ organization.storageUsed }}GB / {{ organization.storageLimit }}GB</span
                    >
                  </div>
                  <div class="mt-2 bg-background-tertiary rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${(organization.storageUsed / organization.storageLimit) * 100}%`,
                      }"
                    />
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between text-sm">
                    <span>{{ $t("organizations.overview.activeAgentsUsage") }}</span>
                    <span>{{ organization.agentCount }} / {{ organization.agentLimit }}</span>
                  </div>
                  <div class="mt-2 bg-background-tertiary rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full"
                      :style="{
                        width: `${(organization.agentCount / organization.agentLimit) * 100}%`,
                      }"
                    />
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
              {{ $t("organizations.members.title") }}
            </h3>
            <p class="text-sm text-neutral-muted">{{ $t("organizations.members.description") }}</p>
          </div>
          <Button @click="inviteMember">
            <UserPlus class="mr-2 h-4 w-4" />
            {{ $t("organizations.members.inviteMember") }}
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
                    <p class="font-medium text-foreground">
                      {{ member.name }}
                    </p>
                    <p class="text-sm text-neutral-muted">
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
                      <option value="admin">{{ $t("organizations.members.roles.admin") }}</option>
                      <option value="member">{{ $t("organizations.members.roles.member") }}</option>
                      <option value="viewer">{{ $t("organizations.members.roles.viewer") }}</option>
                    </select>
                  </div>
                  <Button variant="ghost" size="sm" @click="removeMember(member)">
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
            <CardTitle>{{ $t("organizations.settings.generalTitle") }}</CardTitle>
            <CardDescription>
              {{ $t("organizations.settings.generalDescription") }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label html-for="orgName">{{ $t("organizations.settings.orgName") }}</Label>
              <Input
                id="orgName"
                v-model="organizationForm.name"
                :placeholder="$t('organizations.settings.orgNamePlaceholder')"
              />
            </div>
            <div>
              <Label html-for="orgDescription">{{
                $t("organizations.settings.descriptionLabel")
              }}</Label>
              <Input
                id="orgDescription"
                v-model="organizationForm.description"
                :placeholder="$t('organizations.settings.descriptionPlaceholder')"
              />
            </div>
            <div>
              <Label html-for="timezone">{{ $t("organizations.settings.timezone") }}</Label>
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
              <Button @click="saveSettings">
                {{ $t("organizations.settings.saveChanges") }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{{ $t("organizations.settings.securityTitle") }}</CardTitle>
            <CardDescription>
              {{ $t("organizations.settings.securityDescription") }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">{{ $t("organizations.settings.twoFactor") }}</p>
                <p class="text-sm text-neutral-muted">
                  {{ $t("organizations.settings.twoFactorDescription") }}
                </p>
              </div>
              <Checkbox v-model:checked="organizationForm.require2FA" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="font-medium">{{ $t("organizations.settings.sso") }}</p>
                <p class="text-sm text-neutral-muted">
                  {{ $t("organizations.settings.ssoDescription") }}
                </p>
              </div>
              <Checkbox v-model:checked="organizationForm.ssoEnabled" />
            </div>
            <div class="flex justify-end">
              <Button @click="saveSecuritySettings">
                {{ $t("organizations.settings.saveSecuritySettings") }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{{ $t("organizations.settings.apiKeys") }}</CardTitle>
            <CardDescription>
              {{ $t("organizations.settings.apiKeysDescription") }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <div>
                  <h4 class="font-medium">{{ $t("organizations.settings.primaryApiKey") }}</h4>
                  <p class="text-sm text-neutral-muted">
                    {{ $t("organizations.settings.usedForApiAccess") }}
                  </p>
                </div>
                <div class="flex space-x-2">
                  <Button variant="outline" size="sm" @click="regenerateApiKey">
                    <RefreshCw class="mr-2 h-4 w-4" />
                    {{ $t("organizations.settings.regenerate") }}
                  </Button>
                  <Button variant="outline" size="sm" @click="copyApiKey">
                    <Copy class="mr-2 h-4 w-4" />
                    {{ $t("organizations.settings.copy") }}
                  </Button>
                </div>
              </div>
              <div class="bg-background-tertiary p-3 rounded font-mono text-sm">
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
        <div class="h-16 w-16 bg-background-tertiary rounded-lg animate-pulse" />
        <div class="flex-1 space-y-2">
          <div class="h-6 bg-background-tertiary rounded w-1/3 animate-pulse" />
          <div class="h-4 bg-background-tertiary rounded w-2/3 animate-pulse" />
          <div class="h-3 bg-background-tertiary rounded w-1/2 animate-pulse" />
        </div>
      </div>
    </div>
  </div>

  <!-- Error State -->
  <div v-else class="text-center py-12">
    <AlertCircle class="mx-auto h-12 w-12 text-red-500" />
    <h3 class="mt-4 text-lg font-medium text-foreground">{{ $t("organizations.notFound") }}</h3>
    <p class="mt-2 text-sm text-neutral-muted">
      {{ $t("organizations.notFoundDescription") }}
    </p>
    <div class="mt-6">
      <Button @click="router.push('/organizations')">
        {{ $t("organizations.backToOrganizations") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

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
interface OrganizationForm {
  name: string;
  description: string;
  timezone: string;
  require2FA: boolean;
  ssoEnabled: boolean;
}

const organizationForm = reactive<OrganizationForm>({
  name: "",
  description: "",
  timezone: "UTC",
  require2FA: false,
  ssoEnabled: false,
});

// Tab configuration
const tabs = [
  { id: "overview", name: t("organizations.tabs.overview"), icon: BarChart3 },
  { id: "members", name: t("organizations.tabs.members"), icon: Users },
  { id: "settings", name: t("organizations.tabs.settings"), icon: Settings },
];

interface Organization {
  id: string;
  name: string;
  description: string;
  status: string;
  memberCount: number;
  agentCount: number;
  totalConversations: number;
  storageUsed: number;
  storageLimit: number;
  apiCalls: number;
  apiLimit: number;
  agentLimit: number;
  createdAt: Date;
  apiKey: string;
}

// Mock organization data - TODO: Replace with real API calls
const organization = ref<Organization | null>(null);
interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: Date;
}

const members = ref<Member[]>([
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
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: 2,
    type: "info",
    icon: Bot,
    title: "Agent updated",
    description: "Customer Support Bot configuration was modified",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
  },
  {
    id: 3,
    type: "success",
    icon: Key,
    title: "API key regenerated",
    description: "Primary API key was regenerated for security",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8),
  },
]);

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
      description: "Main business organization for customer support and sales automation",
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
  } finally {
    loading.value = false;
  }
};

const editOrganization = () => {
  console.log("Edit organization");
};

const switchToOrganization = async () => {
  try {
    console.log("Switch to organization:", organizationId);
  } catch (error) {
    console.error("Error switching organization:", error);
  }
};

const inviteMember = () => {
  console.log("Invite member");
};

const updateMemberRole = async (member: Member) => {
  try {
    console.log("Update member role:", member.id, member.role);
  } catch (error) {
    console.error("Error updating member role:", error);
  }
};

const removeMember = async (member: Member) => {
  try {
    console.log("Remove member:", member.id);
  } catch (error) {
    console.error("Error removing member:", error);
  }
};

const saveSettings = async () => {
  try {
    console.log("Save settings:", organizationForm);
  } catch (error) {
    console.error("Error saving settings:", error);
  }
};

const saveSecuritySettings = async () => {
  try {
    console.log("Save security settings");
  } catch (error) {
    console.error("Error saving security settings:", error);
  }
};

const regenerateApiKey = async () => {
  try {
    console.log("Regenerate API key");
  } catch (error) {
    console.error("Error regenerating API key:", error);
  }
};

const copyApiKey = async () => {
  try {
    await navigator.clipboard.writeText(organization.value?.apiKey || "");
    console.log("API key copied to clipboard");
  } catch (error) {
    console.error("Error copying API key:", error);
  }
};

// Lifecycle
onMounted(async () => {
  await loadOrganization();
});

// SEO
useHead({
  title: computed(() =>
    organization.value
      ? `${organization.value.name} - Hay Dashboard`
      : "Organization - Hay Dashboard",
  ),
  meta: [
    {
      name: "description",
      content: "Manage organization settings, members, and configuration",
    },
  ],
});
</script>
