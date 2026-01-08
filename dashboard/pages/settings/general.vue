<template>
  <Page title="General Settings" description="Manage your platform preferences and configuration">
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="resetToDefaults">
          <RotateCcw class="h-4 w-4 mr-2" />
          Reset to Defaults
        </Button>
        <Button :loading="isSaving" :disabled="!hasChanges" @click="saveSettings">
          <Save class="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </template>

    <!-- Delete Organization Dialog -->
    <DeleteOrganizationDialog
      v-model:open="showDeleteDialog"
      :organization-name="settings.organizationName"
      @deleted="onOrganizationDeleted"
    />

    <!-- Organization Settings -->
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>Manage your organization details</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <Input
          v-model="settings.organizationName"
          label="Organization Name"
          placeholder="Acme Corporation"
          helper-text="The name of your organization"
        />

        <Input
          v-model="settings.organizationAbout"
          type="textarea"
          label="About Organization"
          :rows="6"
          placeholder="Describe what your organization does, what products or services you offer, your mission, values, etc. This information helps the AI assistant provide more contextually relevant responses."
          helper-text="This information helps AI understand your business context. Max 10,000 characters."
          :maxlength="10000"
        />

        <!-- Organization Logo -->
        <div>
          <label class="text-sm font-medium mb-2 block">Logo</label>
          <div class="space-y-4">
            <!-- Logo Preview -->
            <div v-if="logoUpload.preview.value || organizationLogo" class="flex items-start gap-4">
              <img
                :src="logoUpload.preview.value || organizationLogo || ''"
                alt="Organization logo"
                class="h-24 w-24 rounded-lg border object-cover"
              />
              <Button
                variant="outline"
                size="sm"
                :disabled="logoUpload.isUploading.value"
                @click="removeLogo"
              >
                <Trash2 class="h-4 w-4 mr-2" />
                Remove Logo
              </Button>
            </div>

            <!-- File Input -->
            <div class="space-y-2">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="handleLogoSelect"
                :disabled="logoUpload.isUploading.value"
              />
              <p class="text-sm text-muted-foreground">
                Recommended: Square image, max 2MB (JPG, PNG, WebP, or GIF)
              </p>
              <p v-if="logoUpload.error.value" class="text-sm text-destructive">
                {{ logoUpload.error.value }}
              </p>
              <p v-if="logoUpload.isUploading.value" class="text-sm text-blue-600">
                Uploading logo...
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Platform Settings -->
    <Card>
      <CardHeader>
        <CardTitle>Platform Settings</CardTitle>
        <CardDescription>Configure basic platform preferences</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2">
          <Input
            v-model="settings.defaultLanguage"
            type="select"
            label="Default Language"
            :options="[
              { label: 'English', value: 'en' },
              { label: 'Portuguese', value: 'pt' },
            ]"
            helper-text="Default language for new conversations and system messages"
          />

          <Input
            v-model="settings.timezone"
            type="select"
            label="Timezone"
            :options="timezoneOptions"
            helper-text="Used for displaying timestamps and scheduling reports"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <Input
            v-model="settings.dateFormat"
            type="select"
            label="Date Format"
            :options="[
              { label: 'MM/DD/YYYY (US)', value: 'MM/DD/YYYY' },
              { label: 'DD/MM/YYYY (EU)', value: 'DD/MM/YYYY' },
              { label: 'YYYY-MM-DD (ISO)', value: 'YYYY-MM-DD' },
              { label: 'DD MMM YYYY', value: 'DD MMM YYYY' },
            ]"
            :helper-text="`Preview: ${formatDatePreview()}`"
          />

          <Input
            v-model="settings.timeFormat"
            type="select"
            label="Time Format"
            :options="[
              { label: '12-hour (AM/PM)', value: '12h' },
              { label: '24-hour', value: '24h' },
            ]"
            :helper-text="`Preview: ${formatTimePreview()}`"
          />
        </div>

        <Input
          v-model="settings.defaultAgent"
          type="select"
          label="Default Agent"
          :options="agentOptions"
          placeholder="No default agent"
          helper-text="Agent to handle conversations when no specific agent is assigned"
        />

        <div class="space-y-2 pt-2 border-t">
          <Label>Test Mode Default</Label>
          <p class="text-sm text-neutral-muted mb-3">
            When enabled, AI messages require approval before sending to customers. Individual
            agents can override this setting.
          </p>
          <div class="flex items-center space-x-2">
            <Checkbox
              id="testModeDefault"
              :checked="settings.testModeDefault"
              @update:checked="settings.testModeDefault = $event"
            />
            <label for="testModeDefault" class="text-sm font-medium cursor-pointer">
              Require approval for AI messages by default
            </label>
          </div>
          <p class="text-xs text-neutral-muted mt-2">
            ℹ️ Note: Playground conversations always auto-send regardless of this setting.
          </p>
        </div>
      </CardContent>
    </Card>

    <!-- AI Confidence Guardrails -->
    <Card>
      <CardHeader>
        <CardTitle>AI Confidence Guardrails</CardTitle>
        <CardDescription>
          Configure how AI responses are evaluated for confidence and accuracy
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- Confidence Thresholds -->
        <div class="space-y-4">
          <div>
            <Label>Confidence Thresholds</Label>
            <p class="text-sm text-neutral-muted mb-4">
              Set the minimum confidence scores required for different quality tiers
            </p>
            <div class="grid gap-4 md:grid-cols-2">
              <Input
                v-model.number="settings.confidenceGuardrail.highThreshold"
                type="number"
                label="High Confidence Threshold"
                :min="0"
                :max="1"
                :step="0.05"
                helper-text="Minimum score for high confidence (0.0 - 1.0)"
              />
              <Input
                v-model.number="settings.confidenceGuardrail.mediumThreshold"
                type="number"
                label="Medium Confidence Threshold"
                :min="0"
                :max="1"
                :step="0.05"
                helper-text="Minimum score for medium confidence (0.0 - 1.0)"
              />
            </div>
          </div>
        </div>

        <!-- Enable/Disable Features -->
        <div class="space-y-4 pt-2 border-t">
          <Input
            v-model="settings.confidenceGuardrail.enableRecheck"
            type="switch"
            label="Enable Automatic Recheck"
            hint="When confidence is medium, automatically retrieve more documents and regenerate the response"
          />

          <Input
            v-model="settings.confidenceGuardrail.enableEscalation"
            type="switch"
            label="Enable Human Escalation"
            hint="When confidence is low, escalate to a human agent instead of sending the AI response"
          />
        </div>

        <!-- Recheck Configuration -->
        <div v-if="settings.confidenceGuardrail.enableRecheck" class="space-y-4 pt-2 border-t">
          <div>
            <Label>Recheck Configuration</Label>
            <p class="text-sm text-neutral-muted mb-4">
              Parameters used when rechecking medium-confidence responses
            </p>
            <div class="grid gap-4 md:grid-cols-2">
              <Input
                v-model.number="settings.confidenceGuardrail.recheckConfig.maxDocuments"
                type="number"
                label="Max Documents"
                :min="1"
                :max="50"
                helper-text="Number of documents to retrieve (default: 10)"
              />
              <Input
                v-model.number="settings.confidenceGuardrail.recheckConfig.similarityThreshold"
                type="number"
                label="Similarity Threshold"
                :min="0"
                :max="1"
                :step="0.05"
                helper-text="Lower threshold for broader search (default: 0.3)"
              />
            </div>
          </div>
        </div>

        <!-- Fallback Message -->
        <div class="pt-2 border-t">
          <Input
            v-model="settings.confidenceGuardrail.fallbackMessage"
            type="textarea"
            label="Fallback Message"
            :rows="3"
            placeholder="Enter fallback message..."
            helper-text="Message shown when confidence is low and escalation is disabled. Will be automatically translated to match conversation language."
          />
        </div>
      </CardContent>
    </Card>

    <!-- Notification Preferences -->
    <!-- <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription> Control how and when you receive notifications </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div>
          <h3 class="font-medium mb-3">Email Notifications</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">New Conversations</Label>
                <p class="text-xs text-neutral-muted">
                  Get notified when a new conversation starts
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.newConversations" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Escalated Conversations</Label>
                <p class="text-xs text-neutral-muted">
                  When a conversation needs human intervention
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.escalatedConversations" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Agent Performance Alerts</Label>
                <p class="text-xs text-neutral-muted">
                  When agent performance drops below thresholds
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.performanceAlerts" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Weekly Reports</Label>
                <p class="text-xs text-neutral-muted">Weekly performance summary emails</p>
              </div>
              <Checkbox v-model="settings.notifications.email.weeklyReports" />
            </div>
          </div>
        </div>

        <div>
          <h3 class="font-medium mb-3">In-App Notifications</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Real-time Alerts</Label>
                <p class="text-xs text-neutral-muted">Show notifications in the dashboard</p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.realTimeAlerts" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">System Updates</Label>
                <p class="text-xs text-neutral-muted">
                  Notifications about system updates and maintenance
                </p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.systemUpdates" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Feature Announcements</Label>
                <p class="text-xs text-neutral-muted">New features and product updates</p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.featureAnnouncements" />
            </div>
          </div>
        </div>

        <div>
          <h3 class="font-medium mb-3">Notification Timing</h3>
          <div class="grid gap-4 md:grid-cols-2">
            <Input
              v-model="settings.notifications.quietHours.start"
              label="Quiet Hours Start"
              type="time"
            />
            <Input
              v-model="settings.notifications.quietHours.end"
              label="Quiet Hours End"
              type="time"
            />
          </div>
          <p class="text-xs text-neutral-muted mt-1">
            No notifications will be sent during quiet hours (except critical alerts)
          </p>
        </div>
      </CardContent>
    </Card> -->

    <!-- Webhook Configuration -->
    <!-- <Card>
      <CardHeader>
        <CardTitle>Webhook Configuration</CardTitle>
        <CardDescription> Configure external webhook endpoints for notifications </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div>
          <Label for="webhook-url">Webhook URL</Label>
          <Input
            id="webhook-url"
            v-model="settings.webhooks.url"
            placeholder="https://your-domain.com/webhook"
            class="mt-1"
          />
          <p class="text-xs text-neutral-muted mt-1">Endpoint to receive webhook notifications</p>
        </div>

        <div>
          <Label for="webhook-secret">Webhook Secret</Label>
          <Input
            id="webhook-secret"
            v-model="settings.webhooks.secret"
            type="password"
            placeholder="Enter webhook secret for verification"
            class="mt-1"
          />
          <p class="text-xs text-neutral-muted mt-1">
            Secret key for webhook signature verification
          </p>
        </div>

        <div>
          <Label>Webhook Events</Label>
          <div class="grid gap-2 mt-2 md:grid-cols-2">
            <div v-for="event in webhookEvents" :key="event.id" class="flex items-center space-x-2">
              <Checkbox
                :id="event.id"
                :checked="settings.webhooks.events.includes(event.id)"
                @update:checked="toggleWebhookEvent(event.id)"
              />
              <Label :for="event.id" class="text-sm">{{ event.name }}</Label>
            </div>
          </div>
        </div>

        <div class="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="!settings.webhooks.url"
            @click="testWebhook"
          >
            <Zap class="h-4 w-4 mr-2" />
            Test Webhook
          </Button>
          <Button variant="outline" size="sm" @click="viewWebhookLogs">
            <FileText class="h-4 w-4 mr-2" />
            View Logs
          </Button>
        </div>
      </CardContent>
    </Card> -->

    <!-- Data Retention -->
    <!-- <Card>
      <CardHeader>
        <CardTitle>Data Retention</CardTitle>
        <CardDescription> Configure how long different types of data are kept </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <Label for="conversation-retention">Conversation Data</Label>
            <select
              id="conversation-retention"
              v-model="settings.dataRetention.conversations"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
              <option value="-1">Forever</option>
            </select>
          </div>

          <div>
            <Label for="analytics-retention">Analytics Data</Label>
            <select
              id="analytics-retention"
              v-model="settings.dataRetention.analytics"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
              <option value="1825">5 years</option>
              <option value="-1">Forever</option>
            </select>
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <Label for="logs-retention">System Logs</Label>
            <select
              id="logs-retention"
              v-model="settings.dataRetention.logs"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>

          <div>
            <Label for="exports-retention">Exported Reports</Label>
            <select
              id="exports-retention"
              v-model="settings.dataRetention.exports"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
        </div>

        <div class="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div class="flex items-start space-x-2">
            <AlertTriangle class="h-4 w-4 text-yellow-600 mt-0.5" />
            <div class="text-sm">
              <p class="font-medium text-yellow-800">Data Retention Policy</p>
              <p class="text-yellow-700">
                Changing retention settings will only affect new data. Existing data will be
                retained according to previous settings. Consider compliance requirements before
                making changes.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card> -->

    <!-- Danger Zone - Only visible to owners -->
    <Card v-if="isOwner" class="!border-destructive">
      <CardHeader>
        <CardTitle class="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible and destructive actions</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between border p-4 rounded-lg">
          <div>
            <p class="font-medium">Delete organization</p>
            <p class="text-sm text-muted-foreground">
              Once you delete an organization, there is no going back. Please be certain.
            </p>
          </div>
          <Button variant="destructive" @click="showDeleteDialog = true">
            Delete organization
          </Button>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { Save, RotateCcw, Trash2 } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useFileUpload } from "@/composables/useFileUpload";
import { useUserStore } from "@/stores/user";
import { TIMEZONE_GROUPS } from "@/utils/timezones";

const toast = useToast();

const logoUpload = useFileUpload({
  accept: "image/*",
  maxSizeMB: 2,
});

const organizationLogo = ref<string | null>(null);
const showDeleteDialog = ref(false);

// Import types for proper typing
type ConfidenceGuardrailSettings = {
  highThreshold: number;
  mediumThreshold: number;
  enableRecheck: boolean;
  enableEscalation: boolean;
  fallbackMessage: string;
  recheckConfig: {
    maxDocuments: number;
    similarityThreshold: number;
  };
};

type PlatformSettings = {
  organizationName: string;
  organizationAbout: string;
  defaultLanguage: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  defaultAgent: string;
  testModeDefault: boolean;
  confidenceGuardrail: ConfidenceGuardrailSettings;
  notifications: any;
  webhooks: any;
  dataRetention: any;
};

// Reactive state
const originalSettings = ref<PlatformSettings>({} as PlatformSettings);
const isSaving = ref(false);
const settings = ref<PlatformSettings>({
  organizationName: "",
  organizationAbout: "",
  defaultLanguage: "en",
  timezone: "UTC",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  defaultAgent: "",
  testModeDefault: false,
  confidenceGuardrail: {
    highThreshold: 0.8,
    mediumThreshold: 0.5,
    enableRecheck: true,
    enableEscalation: true,
    fallbackMessage:
      "I'm not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help.",
    recheckConfig: {
      maxDocuments: 10,
      similarityThreshold: 0.3,
    },
  },
  notifications: {
    email: {
      newConversations: true,
      escalatedConversations: true,
      performanceAlerts: false,
      weeklyReports: true,
    },
    inApp: {
      realTimeAlerts: true,
      systemUpdates: true,
      featureAnnouncements: true,
    },
    quietHours: {
      start: "22:00",
      end: "08:00",
    },
  },
  webhooks: {
    url: "",
    secret: "",
    events: [] as string[],
  },
  dataRetention: {
    conversations: "365",
    analytics: "730",
    logs: "90",
    exports: "30",
  },
});

// Agents data
const agents = ref<any[]>([]);

const webhookEvents = [
  { id: "conversation.started", name: "Conversation Started" },
  { id: "conversation.ended", name: "Conversation Ended" },
  { id: "conversation.escalated", name: "Conversation Escalated" },
  { id: "agent.performance.alert", name: "Agent Performance Alert" },
  { id: "system.error", name: "System Error" },
  { id: "user.feedback", name: "User Feedback Received" },
];

// Computed properties
const hasChanges = computed(() => {
  return JSON.stringify(settings.value) !== JSON.stringify(originalSettings.value);
});

const timezoneOptions = computed(() => {
  const options: { label: string; value: string }[] = [];
  TIMEZONE_GROUPS.forEach((group) => {
    group.options.forEach((tz) => {
      options.push({ label: tz.label, value: tz.value });
    });
  });
  return options;
});

const agentOptions = computed(() => {
  return agents.value.map((agent) => ({
    label: agent.name,
    value: agent.id,
  }));
});

const isOwner = computed(() => {
  const userStore = useUserStore();
  return userStore.isOwner;
});

// Methods
const formatDatePreview = () => {
  const now = new Date();
  const formats = {
    "MM/DD/YYYY": `${(now.getMonth() + 1).toString().padStart(2, "0")}/${now
      .getDate()
      .toString()
      .padStart(2, "0")}/${now.getFullYear()}`,
    "DD/MM/YYYY": `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1)
      .toString()
      .padStart(2, "0")}/${now.getFullYear()}`,
    "YYYY-MM-DD": `${now.getFullYear()}-${(now.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`,
    "DD MMM YYYY": now.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
  };
  return formats[settings.value.dateFormat as keyof typeof formats] || "Invalid format";
};

const formatTimePreview = () => {
  const now = new Date();
  if (settings.value.timeFormat === "12h") {
    return now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } else {
    return now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
};

const toggleWebhookEvent = (eventId: string) => {
  const index = settings.value.webhooks.events.indexOf(eventId);
  if (index > -1) {
    settings.value.webhooks.events.splice(index, 1);
  } else {
    settings.value.webhooks.events.push(eventId);
  }
};

const handleLogoSelect = async (event: Event) => {
  logoUpload.error.value = null;
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  // Validate size
  if (file.size > 2 * 1024 * 1024) {
    logoUpload.error.value = "File too large (max 2MB)";
    return;
  }

  try {
    logoUpload.isUploading.value = true;

    // Read file as base64
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = (e) => {
        const result = e.target?.result as string;
        resolve(result);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    const base64 = await base64Promise;

    // Upload logo immediately
    await Hay.organizations.uploadLogo.mutate({
      logo: base64,
    });

    // Reload settings to get the new logo URL and update the store
    await loadOrganizationSettings();

    toast.success("Logo uploaded successfully");

    // Clear the file input so the same file can be selected again if needed
    target.value = "";
  } catch (error) {
    console.error("Failed to upload logo:", error);
    toast.error("Failed to upload logo. Please try again.");
    logoUpload.error.value = "Failed to upload logo";
  } finally {
    logoUpload.isUploading.value = false;
  }
};

const saveSettings = async () => {
  try {
    isSaving.value = true;

    // Save platform settings to API
    const response = await Hay.organizations.updateSettings.mutate({
      name: settings.value.organizationName,
      about: settings.value.organizationAbout,
      defaultLanguage: settings.value.defaultLanguage as any,
      timezone: settings.value.timezone as any,
      dateFormat: settings.value.dateFormat as any,
      timeFormat: settings.value.timeFormat as any,
      defaultAgentId: settings.value.defaultAgent || null,
      testModeDefault: settings.value.testModeDefault,
      confidenceGuardrail: {
        ...settings.value.confidenceGuardrail,
        // Ensure boolean values are properly typed (Input component may return strings)
        enableRecheck: Boolean(settings.value.confidenceGuardrail.enableRecheck),
        enableEscalation: Boolean(settings.value.confidenceGuardrail.enableEscalation),
        // Ensure number values are properly typed
        highThreshold: Number(settings.value.confidenceGuardrail.highThreshold),
        mediumThreshold: Number(settings.value.confidenceGuardrail.mediumThreshold),
        recheckConfig: {
          maxDocuments: Number(settings.value.confidenceGuardrail.recheckConfig.maxDocuments),
          similarityThreshold: Number(
            settings.value.confidenceGuardrail.recheckConfig.similarityThreshold,
          ),
        },
      },
    });

    if (response.success) {
      // Update original settings to new saved state
      originalSettings.value = JSON.parse(JSON.stringify(settings.value));

      // Update the organization name in the user store if it changed
      if ((response.data as any).name) {
        const userStore = useUserStore();
        const activeOrg = userStore.organizations.find(
          (org: any) => org.id === userStore.activeOrganizationId,
        );
        if (activeOrg) {
          activeOrg.name = (response.data as any).name;
        }
      }

      toast.success("Settings saved successfully");
    }
  } catch (error) {
    console.error("Failed to save settings:", error);
    toast.error("Failed to save settings. Please try again.");
  } finally {
    isSaving.value = false;
  }
};

const removeLogo = async () => {
  try {
    await Hay.organizations.deleteLogo.mutate();
    toast.success("Logo removed successfully");
    logoUpload.reset();

    // Clear logo from local state
    organizationLogo.value = null;

    // Update the user store to remove the logo immediately
    const userStore = useUserStore();
    const activeOrg = userStore.organizations.find(
      (org: any) => org.id === userStore.activeOrganizationId,
    );
    if (activeOrg) {
      activeOrg.logo = null;
    }
  } catch (error) {
    console.error("Failed to remove logo:", error);
    toast.error("Failed to remove logo. Please try again.");
  }
};

const loadOrganizationSettings = async () => {
  try {
    const orgSettings = await Hay.organizations.getSettings.query();
    organizationLogo.value = (orgSettings as any).logoUrl || null;

    // Update the logo in the user store so it shows in the org switcher immediately
    const userStore = useUserStore();
    const activeOrg = userStore.organizations.find(
      (org: any) => org.id === userStore.activeOrganizationId,
    );
    if (activeOrg) {
      activeOrg.logo = (orgSettings as any).logoUrl || null;
    }
  } catch (error) {
    console.error("Failed to load organization logo:", error);
  }
};

const resetToDefaults = () => {
  if (confirm("Are you sure you want to reset all settings to their default values?")) {
    settings.value = {
      organizationName: originalSettings.value.organizationName,
      organizationAbout: originalSettings.value.organizationAbout,
      defaultLanguage: "en",
      timezone: "UTC",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      defaultAgent: "",
      testModeDefault: false,
      confidenceGuardrail: {
        highThreshold: 0.8,
        mediumThreshold: 0.5,
        enableRecheck: true,
        enableEscalation: true,
        fallbackMessage:
          "I'm not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help.",
        recheckConfig: {
          maxDocuments: 10,
          similarityThreshold: 0.3,
        },
      },
      notifications: {
        email: {
          newConversations: true,
          escalatedConversations: true,
          performanceAlerts: false,
          weeklyReports: true,
        },
        inApp: {
          realTimeAlerts: true,
          systemUpdates: true,
          featureAnnouncements: true,
        },
        quietHours: {
          start: "22:00",
          end: "08:00",
        },
      },
      webhooks: {
        url: "",
        secret: "",
        events: [],
      },
      dataRetention: {
        conversations: "365",
        analytics: "730",
        logs: "90",
        exports: "30",
      },
    };
  }
};

const testWebhook = async () => {
  try {
    // TODO: Send test webhook
    console.log("Testing webhook:", settings.value.webhooks.url);

    // TODO: Show result toast
    console.log("Webhook test sent successfully");
  } catch (error) {
    console.error("Webhook test failed:", error);
  }
};

const viewWebhookLogs = () => {
  // TODO: Navigate to webhook logs page
  console.log("View webhook logs");
};

const onOrganizationDeleted = () => {
  // Dialog handles the redirect/logout logic
  showDeleteDialog.value = false;
};

// Lifecycle
onMounted(async () => {
  try {
    // Load agents
    const agentsResponse = await Hay.agents.list.query();
    agents.value = agentsResponse || [];

    // Load current platform settings from API
    const orgSettings = await Hay.organizations.getSettings.query();

    // Update only platform settings, keep other settings as mock for now
    settings.value.organizationName = (orgSettings as any).name;
    settings.value.organizationAbout = (orgSettings as any).about || "";
    settings.value.defaultLanguage = orgSettings.defaultLanguage;
    settings.value.timezone = orgSettings.timezone;
    settings.value.dateFormat = orgSettings.dateFormat;
    settings.value.timeFormat = orgSettings.timeFormat;
    settings.value.defaultAgent = orgSettings.defaultAgentId || "";
    settings.value.testModeDefault =
      "testModeDefault" in orgSettings
        ? ((orgSettings as Record<string, unknown>).testModeDefault as boolean)
        : false;

    // Load organization logo
    organizationLogo.value = (orgSettings as any).logoUrl || null;

    // Load confidence guardrail settings
    if (orgSettings.confidenceGuardrail) {
      settings.value.confidenceGuardrail = {
        ...settings.value.confidenceGuardrail,
        ...(orgSettings.confidenceGuardrail as any),
      };
    }

    // Store original settings for change detection
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));
  } catch (error) {
    console.error("Failed to load settings:", error);
    toast.error("Error", "Failed to load settings");
  }
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "General Settings - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage your platform preferences and configuration",
    },
  ],
});
</script>
