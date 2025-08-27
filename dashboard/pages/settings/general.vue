<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">General Settings</h1>
        <p class="text-muted-foreground">Manage your platform preferences and configuration</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="resetToDefaults">
          <RotateCcw class="h-4 w-4 mr-2" />
          Reset to Defaults
        </Button>
        <Button :disabled="!hasChanges" @click="saveSettings">
          <Save class="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>

    <!-- Platform Settings -->
    <Card>
      <CardHeader>
        <CardTitle>Platform Settings</CardTitle>
        <CardDescription>Configure basic platform preferences</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <div class="grid gap-6 md:grid-cols-2">
          <div>
            <Label for="default-language">Default Language</Label>
            <select
              id="default-language"
              v-model="settings.defaultLanguage"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
            </select>
            <p class="text-xs text-muted-foreground mt-1">
              Default language for new conversations and system messages
            </p>
          </div>

          <div>
            <Label for="timezone">Timezone</Label>
            <select
              id="timezone"
              v-model="settings.timezone"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="Europe/London">London (GMT)</option>
              <option value="Europe/Paris">Paris (CET)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
              <option value="Australia/Sydney">Sydney (AEDT)</option>
            </select>
            <p class="text-xs text-muted-foreground mt-1">
              Used for displaying timestamps and scheduling reports
            </p>
          </div>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <div>
            <Label for="date-format">Date Format</Label>
            <select
              id="date-format"
              v-model="settings.dateFormat"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (EU)</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              <option value="DD MMM YYYY">DD MMM YYYY</option>
            </select>
            <p class="text-xs text-muted-foreground mt-1">Preview: {{ formatDatePreview() }}</p>
          </div>

          <div>
            <Label for="time-format">Time Format</Label>
            <select
              id="time-format"
              v-model="settings.timeFormat"
              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
            >
              <option value="12h">12-hour (AM/PM)</option>
              <option value="24h">24-hour</option>
            </select>
            <p class="text-xs text-muted-foreground mt-1">Preview: {{ formatTimePreview() }}</p>
          </div>
        </div>

        <div>
          <Label for="default-agent">Default Agent</Label>
          <select
            id="default-agent"
            v-model="settings.defaultAgent"
            class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
          >
            <option value="">No default agent</option>
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agent.name }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground mt-1">
            Agent to handle conversations when no specific agent is assigned
          </p>
        </div>
      </CardContent>
    </Card>

    <!-- Notification Preferences -->
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>Control how and when you receive notifications</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- Email Notifications -->
        <div>
          <h3 class="font-medium mb-3">Email Notifications</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">New Conversations</Label>
                <p class="text-xs text-muted-foreground">
                  Get notified when a new conversation starts
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.newConversations" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Escalated Conversations</Label>
                <p class="text-xs text-muted-foreground">
                  When a conversation needs human intervention
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.escalatedConversations" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Agent Performance Alerts</Label>
                <p class="text-xs text-muted-foreground">
                  When agent performance drops below thresholds
                </p>
              </div>
              <Checkbox v-model="settings.notifications.email.performanceAlerts" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Weekly Reports</Label>
                <p class="text-xs text-muted-foreground">Weekly performance summary emails</p>
              </div>
              <Checkbox v-model="settings.notifications.email.weeklyReports" />
            </div>
          </div>
        </div>

        <!-- In-App Notifications -->
        <div>
          <h3 class="font-medium mb-3">In-App Notifications</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Real-time Alerts</Label>
                <p class="text-xs text-muted-foreground">Show notifications in the dashboard</p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.realTimeAlerts" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">System Updates</Label>
                <p class="text-xs text-muted-foreground">
                  Notifications about system updates and maintenance
                </p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.systemUpdates" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Feature Announcements</Label>
                <p class="text-xs text-muted-foreground">New features and product updates</p>
              </div>
              <Checkbox v-model="settings.notifications.inApp.featureAnnouncements" />
            </div>
          </div>
        </div>

        <!-- Notification Timing -->
        <div>
          <h3 class="font-medium mb-3">Notification Timing</h3>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label for="quiet-hours-start">Quiet Hours Start</Label>
              <Input
                id="quiet-hours-start"
                v-model="settings.notifications.quietHours.start"
                type="time"
                class="mt-1"
              />
            </div>
            <div>
              <Label for="quiet-hours-end">Quiet Hours End</Label>
              <Input
                id="quiet-hours-end"
                v-model="settings.notifications.quietHours.end"
                type="time"
                class="mt-1"
              />
            </div>
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            No notifications will be sent during quiet hours (except critical alerts)
          </p>
        </div>
      </CardContent>
    </Card>

    <!-- Webhook Configuration -->
    <Card>
      <CardHeader>
        <CardTitle>Webhook Configuration</CardTitle>
        <CardDescription>Configure external webhook endpoints for notifications</CardDescription>
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
          <p class="text-xs text-muted-foreground mt-1">
            Endpoint to receive webhook notifications
          </p>
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
          <p class="text-xs text-muted-foreground mt-1">
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
    </Card>

    <!-- Data Retention -->
    <Card>
      <CardHeader>
        <CardTitle>Data Retention</CardTitle>
        <CardDescription>Configure how long different types of data are kept</CardDescription>
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
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Save, RotateCcw, Zap, FileText, AlertTriangle } from 'lucide-vue-next';

// Reactive state
const originalSettings = ref({});
const settings = ref({
  defaultLanguage: 'en',
  timezone: 'UTC',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  defaultAgent: '',
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
      start: '22:00',
      end: '08:00',
    },
  },
  webhooks: {
    url: '',
    secret: '',
    events: [] as string[],
  },
  dataRetention: {
    conversations: '365',
    analytics: '730',
    logs: '90',
    exports: '30',
  },
});

// Mock data - TODO: Replace with actual API calls
const agents = ref([
  { id: '1', name: 'Customer Support Agent' },
  { id: '2', name: 'Sales Assistant' },
  { id: '3', name: 'Technical Support' },
]);

const webhookEvents = [
  { id: 'conversation.started', name: 'Conversation Started' },
  { id: 'conversation.ended', name: 'Conversation Ended' },
  { id: 'conversation.escalated', name: 'Conversation Escalated' },
  { id: 'agent.performance.alert', name: 'Agent Performance Alert' },
  { id: 'system.error', name: 'System Error' },
  { id: 'user.feedback', name: 'User Feedback Received' },
];

// Computed properties
const hasChanges = computed(() => {
  return JSON.stringify(settings.value) !== JSON.stringify(originalSettings.value);
});

// Methods
const formatDatePreview = () => {
  const now = new Date();
  const formats = {
    'MM/DD/YYYY': `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}/${now.getFullYear()}`,
    'DD/MM/YYYY': `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`,
    'YYYY-MM-DD': `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`,
    'DD MMM YYYY': now.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
  };
  return formats[settings.value.dateFormat as keyof typeof formats] || 'Invalid format';
};

const formatTimePreview = () => {
  const now = new Date();
  if (settings.value.timeFormat === '12h') {
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } else {
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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

const saveSettings = async () => {
  try {
    // TODO: Save settings to API
    console.log('Saving settings:', settings.value);

    // Update original settings to new saved state
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));

    // TODO: Show success toast
    console.log('Settings saved successfully');
  } catch (error) {
    // TODO: Show error toast
    console.error('Failed to save settings:', error);
  }
};

const resetToDefaults = () => {
  if (confirm('Are you sure you want to reset all settings to their default values?')) {
    settings.value = {
      defaultLanguage: 'en',
      timezone: 'UTC',
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12h',
      defaultAgent: '',
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
          start: '22:00',
          end: '08:00',
        },
      },
      webhooks: {
        url: '',
        secret: '',
        events: [],
      },
      dataRetention: {
        conversations: '365',
        analytics: '730',
        logs: '90',
        exports: '30',
      },
    };
  }
};

const testWebhook = async () => {
  try {
    // TODO: Send test webhook
    console.log('Testing webhook:', settings.value.webhooks.url);

    // TODO: Show result toast
    console.log('Webhook test sent successfully');
  } catch (error) {
    console.error('Webhook test failed:', error);
  }
};

const viewWebhookLogs = () => {
  // TODO: Navigate to webhook logs page
  console.log('View webhook logs');
};

// Lifecycle
onMounted(async () => {
  // TODO: Load current settings from API
  // const currentSettings = await fetchSettings()
  // settings.value = currentSettings

  // Store original settings for change detection
  originalSettings.value = JSON.parse(JSON.stringify(settings.value));
});

// Set page meta
definePageMeta({
  layout: 'default',
  middleware: 'auth',
});

// Head management
useHead({
  title: 'General Settings - Hay Dashboard',
  meta: [{ name: 'description', content: 'Manage your platform preferences and configuration' }],
});
</script>
