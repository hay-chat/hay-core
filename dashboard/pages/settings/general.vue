<template>
  <Page :title="$t('general.title')" :description="$t('general.description')">
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="resetToDefaults">
          <RotateCcw class="h-4 w-4 mr-2" />
          {{ $t("general.resetToDefaults") }}
        </Button>
        <Button :loading="isSaving" :disabled="!hasChanges" @click="saveSettings">
          <Save class="h-4 w-4 mr-2" />
          {{ $t("general.saveChanges") }}
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
        <CardTitle>{{ $t("organization.title") }}</CardTitle>
        <CardDescription>{{ $t("organization.description") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <Input
          v-model="settings.organizationName"
          :label="$t('organization.name')"
          :placeholder="$t('organization.namePlaceholder')"
          :helper-text="$t('organization.nameHelper')"
        />

        <Input
          v-model="settings.organizationAbout"
          type="textarea"
          :label="$t('organization.about')"
          :rows="6"
          :placeholder="$t('organization.aboutPlaceholder')"
          :helper-text="$t('organization.aboutHelper')"
          :maxlength="10000"
        />

        <!-- Organization Logo -->
        <div>
          <label class="text-sm font-medium mb-2 block">{{ $t("organization.logo") }}</label>
          <div class="space-y-4">
            <!-- Logo Preview -->
            <div v-if="logoUpload.preview.value || organizationLogo" class="flex items-start gap-4">
              <img
                :src="logoUpload.preview.value || organizationLogo || ''"
                :alt="$t('organization.logoAlt')"
                class="h-24 w-24 rounded-lg border object-cover"
              />
              <Button
                variant="outline"
                size="sm"
                :disabled="logoUpload.isUploading.value"
                @click="removeLogo"
              >
                <Trash2 class="h-4 w-4 mr-2" />
                {{ $t("organization.removeLogo") }}
              </Button>
            </div>

            <!-- File Input -->
            <div class="space-y-2">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                :disabled="logoUpload.isUploading.value"
                @change="handleLogoSelect"
              />
              <p class="text-sm text-muted-foreground">
                {{ $t("organization.logoRecommended") }}
              </p>
              <p v-if="logoUpload.error.value" class="text-sm text-destructive">
                {{ logoUpload.error.value }}
              </p>
              <p v-if="logoUpload.isUploading.value" class="text-sm text-blue-600">
                {{ $t("organization.logoUploading") }}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Platform Settings -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("platform.title") }}</CardTitle>
        <CardDescription>{{ $t("platform.description") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2">
          <Input
            v-model="settings.defaultLanguage"
            type="select"
            :label="$t('platform.defaultLanguage')"
            :options="[
              { label: $t('platform.languages.en'), value: 'en' },
              { label: $t('platform.languages.pt'), value: 'pt' },
            ]"
            :helper-text="$t('platform.defaultLanguageHelper')"
          />

          <Input
            v-model="settings.timezone"
            type="select"
            :label="$t('platform.timezone')"
            :options="timezoneOptions"
            :helper-text="$t('platform.timezoneHelper')"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <Input
            v-model="settings.dateFormat"
            type="select"
            :label="$t('platform.dateFormat')"
            :options="[
              { label: 'MM/DD/YYYY (US)', value: 'MM/DD/YYYY' },
              { label: 'DD/MM/YYYY (EU)', value: 'DD/MM/YYYY' },
              { label: 'YYYY-MM-DD (ISO)', value: 'YYYY-MM-DD' },
              { label: 'DD MMM YYYY', value: 'DD MMM YYYY' },
            ]"
            :helper-text="$t('platform.dateFormatHelper', { preview: formatDatePreview() })"
          />

          <Input
            v-model="settings.timeFormat"
            type="select"
            :label="$t('platform.timeFormat')"
            :options="[
              { label: $t('platform.timeFormats.12h'), value: '12h' },
              { label: $t('platform.timeFormats.24h'), value: '24h' },
            ]"
            :helper-text="$t('platform.timeFormatHelper', { preview: formatTimePreview() })"
          />
        </div>

        <Input
          v-model="settings.defaultAgent"
          type="select"
          :label="$t('platform.defaultAgent')"
          :options="agentOptions"
          :placeholder="$t('platform.defaultAgentPlaceholder')"
          :helper-text="$t('platform.defaultAgentHelper')"
        />

        <div class="space-y-2 pt-2 border-t">
          <Label>{{ $t("platform.testMode") }}</Label>
          <p class="text-sm text-neutral-muted mb-3">
            {{ $t("platform.testModeDescription") }}
          </p>
          <div class="flex items-center space-x-2">
            <Checkbox
              id="testModeDefault"
              :checked="settings.testModeDefault"
              @update:checked="settings.testModeDefault = $event"
            />
            <label for="testModeDefault" class="text-sm font-medium cursor-pointer">
              {{ $t("platform.testModeCheckbox") }}
            </label>
          </div>
          <p class="text-xs text-neutral-muted mt-2">ℹ️ {{ $t("platform.testModeNote") }}</p>
        </div>
      </CardContent>
    </Card>

    <!-- AI Confidence Guardrails -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("confidence.title") }}</CardTitle>
        <CardDescription>
          {{ $t("confidence.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- Confidence Thresholds -->
        <div class="space-y-4">
          <div>
            <Label>{{ $t("confidence.thresholds") }}</Label>
            <p class="text-sm text-neutral-muted mb-4">
              {{ $t("confidence.thresholdsDescription") }}
            </p>
            <div class="grid gap-4 md:grid-cols-2">
              <Input
                v-model.number="settings.confidenceGuardrail.highThreshold"
                type="number"
                :label="$t('confidence.highThreshold')"
                :min="0"
                :max="1"
                :step="0.05"
                :helper-text="$t('confidence.highThresholdHelper')"
              />
              <Input
                v-model.number="settings.confidenceGuardrail.mediumThreshold"
                type="number"
                :label="$t('confidence.mediumThreshold')"
                :min="0"
                :max="1"
                :step="0.05"
                :helper-text="$t('confidence.mediumThresholdHelper')"
              />
            </div>
          </div>
        </div>

        <!-- Enable/Disable Features -->
        <div class="space-y-4 pt-2 border-t">
          <Input
            v-model="settings.confidenceGuardrail.enableRecheck"
            type="switch"
            :label="$t('confidence.enableRecheck')"
            :hint="$t('confidence.recheckHint')"
          />

          <Input
            v-model="settings.confidenceGuardrail.enableEscalation"
            type="switch"
            :label="$t('confidence.enableEscalation')"
            :hint="$t('confidence.escalationHint')"
          />
        </div>

        <!-- Recheck Configuration -->
        <div v-if="settings.confidenceGuardrail.enableRecheck" class="space-y-4 pt-2 border-t">
          <div>
            <Label>{{ $t("confidence.recheckConfig") }}</Label>
            <p class="text-sm text-neutral-muted mb-4">
              {{ $t("confidence.recheckConfigDescription") }}
            </p>
            <div class="grid gap-4 md:grid-cols-2">
              <Input
                v-model.number="settings.confidenceGuardrail.recheckConfig.maxDocuments"
                type="number"
                :label="$t('confidence.maxDocuments')"
                :min="1"
                :max="50"
                :helper-text="$t('confidence.maxDocumentsHelper')"
              />
              <Input
                v-model.number="settings.confidenceGuardrail.recheckConfig.similarityThreshold"
                type="number"
                :label="$t('confidence.similarityThreshold')"
                :min="0"
                :max="1"
                :step="0.05"
                :helper-text="$t('confidence.similarityThresholdHelper')"
              />
            </div>
          </div>
        </div>

        <!-- Fallback Message -->
        <div class="pt-2 border-t">
          <Input
            v-model="settings.confidenceGuardrail.fallbackMessage"
            type="textarea"
            :label="$t('confidence.fallbackMessage')"
            :rows="3"
            :placeholder="$t('confidence.fallbackMessagePlaceholder')"
            :helper-text="$t('confidence.fallbackMessageHelper')"
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

    <!-- Danger Zone - Only visible to owners -->
    <Card v-if="isOwner" class="!border-destructive">
      <CardHeader>
        <CardTitle class="text-destructive">{{ $t("danger.title") }}</CardTitle>
        <CardDescription>{{ $t("danger.description") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between border p-4 rounded-lg">
          <div>
            <p class="font-medium">{{ $t("danger.deleteOrg") }}</p>
            <p class="text-sm text-muted-foreground">
              {{ $t("danger.deleteOrgWarning") }}
            </p>
          </div>
          <Button variant="destructive" @click="showDeleteDialog = true">
            {{ $t("danger.deleteOrg") }}
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

const { t } = useI18n();
const toast = useToast();
const userStore = useUserStore();
const { setLocaleFromBackend } = useLocale();

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
  retentionDays: number | null; // null = disabled/forever
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
  retentionDays: null, // null = disabled/forever
  dataRetention: {
    conversations: "365",
    analytics: "730",
    logs: "90",
    exports: "30",
  },
});

// Agents data
const agents = ref<any[]>([]);

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

const isOwner = computed(() => userStore.isOwner);

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

const handleLogoSelect = async (event: Event) => {
  logoUpload.error.value = null;
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  // Validate size
  if (file.size > 2 * 1024 * 1024) {
    logoUpload.error.value = t("organization.logoTooLarge");
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

    toast.success(t("organization.logoUploadSuccess"));

    // Clear the file input so the same file can be selected again if needed
    target.value = "";
  } catch (error) {
    console.error("Failed to upload logo:", error);
    toast.error(t("organization.logoUploadError"));
    logoUpload.error.value = t("organization.logoUploadFailed");
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
      retentionDays: settings.value.retentionDays,
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
        const activeOrg = userStore.organizations.find(
          (org: any) => org.id === userStore.activeOrganizationId,
        );
        if (activeOrg) {
          activeOrg.name = (response.data as any).name;
        }
      }

      // Sync dashboard locale immediately when language changes
      await setLocaleFromBackend(settings.value.defaultLanguage);

      // Sync date/time formatting immediately when settings change
      const { setOrgDateTimeSettings } = useOrgDateTime();
      setOrgDateTimeSettings({
        dateFormat: settings.value.dateFormat,
        timeFormat: settings.value.timeFormat,
        timezone: settings.value.timezone,
      });

      toast.success(t("general.saveSuccess"));
    }
  } catch (error) {
    console.error("Failed to save settings:", error);
    toast.error(t("general.saveFailed"));
  } finally {
    isSaving.value = false;
  }
};

const removeLogo = async () => {
  try {
    await Hay.organizations.deleteLogo.mutate();
    toast.success(t("organization.logoRemoveSuccess"));
    logoUpload.reset();

    // Clear logo from local state
    organizationLogo.value = null;

    // Update the user store to remove the logo immediately
    const activeOrg = userStore.organizations.find(
      (org: any) => org.id === userStore.activeOrganizationId,
    );
    if (activeOrg) {
      activeOrg.logo = null;
    }
  } catch (error) {
    console.error("Failed to remove logo:", error);
    toast.error(t("organization.logoRemoveFailed"));
  }
};

const loadOrganizationSettings = async () => {
  try {
    const orgSettings = await Hay.organizations.getSettings.query();
    organizationLogo.value = (orgSettings as any).logoUrl || null;

    // Update the logo in the user store so it shows in the org switcher immediately
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
  if (confirm(t("general.resetConfirm"))) {
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
      retentionDays: null, // Default: disabled
      dataRetention: {
        conversations: "365",
        analytics: "730",
        logs: "90",
        exports: "30",
      },
    };
  }
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

    // Load retention days setting
    settings.value.retentionDays =
      "retentionDays" in orgSettings ? (orgSettings.retentionDays as number | null) : null;

    // Store original settings for change detection
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));
  } catch (error) {
    console.error("Failed to load settings:", error);
    toast.error(t("common.error"), t("general.loadFailed"));
  }
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: computed(() => `${t("general.title")} - Hay Dashboard`),
  meta: [
    {
      name: "description",
      content: computed(() => t("general.description")),
    },
  ],
});
</script>
