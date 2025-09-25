<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Security Settings</h1>
        <p class="text-neutral-muted">
          Manage authentication, access controls, and security policies
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="downloadSecurityReport">
          <Download class="h-4 w-4 mr-2" />
          Security Report
        </Button>
        <Button :disabled="!hasChanges" @click="saveSettings">
          <Save class="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>

    <!-- Security Overview -->
    <Card>
      <CardHeader>
        <CardTitle>Security Overview</CardTitle>
        <CardDescription> Current security status and recommendations </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Shield class="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div class="font-medium">Security Score</div>
              <div class="text-2xl font-bold text-green-600">{{ securityScore }}/100</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Key class="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div class="font-medium">Active Sessions</div>
              <div class="text-2xl font-bold">
                {{ activeSessions }}
              </div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <AlertTriangle class="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <div class="font-medium">Security Alerts</div>
              <div class="text-2xl font-bold">
                {{ securityAlerts }}
              </div>
            </div>
          </div>
        </div>

        <!-- Security Recommendations -->
        <div v-if="recommendations.length > 0" class="mt-6">
          <h3 class="font-medium mb-3">Security Recommendations</h3>
          <div class="space-y-2">
            <div
              v-for="rec in recommendations"
              :key="rec.id"
              class="flex items-start space-x-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
            >
              <AlertTriangle class="h-4 w-4 text-yellow-600 mt-0.5" />
              <div class="flex-1">
                <div class="font-medium text-yellow-800">
                  {{ rec.title }}
                </div>
                <div class="text-sm text-yellow-700">
                  {{ rec.description }}
                </div>
              </div>
              <Button variant="outline" size="sm" @click="implementRecommendation(rec.id)">
                Fix
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Authentication Settings -->
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription> Configure password policies and authentication methods </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- Password Requirements -->
        <div>
          <h3 class="font-medium mb-3">Password Requirements</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Minimum Length</Label>
                <p class="text-xs text-neutral-muted">Minimum number of characters required</p>
              </div>
              <select
                v-model="settings.authentication.passwordPolicy.minLength"
                class="px-3 py-2 text-sm border border-input rounded-md"
              >
                <option value="8">8 characters</option>
                <option value="10">10 characters</option>
                <option value="12">12 characters</option>
                <option value="16">16 characters</option>
              </select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Require Uppercase Letters</Label>
                <p class="text-xs text-neutral-muted">At least one uppercase letter (A-Z)</p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireUppercase" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Require Numbers</Label>
                <p class="text-xs text-neutral-muted">At least one number (0-9)</p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireNumbers" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Require Special Characters</Label>
                <p class="text-xs text-neutral-muted">At least one special character (!@#$%^&*)</p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireSpecialChars" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Password Expiration</Label>
                <p class="text-xs text-neutral-muted">Force password change after specified days</p>
              </div>
              <select
                v-model="settings.authentication.passwordPolicy.expirationDays"
                class="px-3 py-2 text-sm border border-input rounded-md"
              >
                <option value="0">Never</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Session Management -->
        <div>
          <h3 class="font-medium mb-3">Session Management</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Session Timeout</Label>
                <p class="text-xs text-neutral-muted">Automatic logout after inactivity</p>
              </div>
              <select
                v-model="settings.authentication.sessionTimeout"
                class="px-3 py-2 text-sm border border-input rounded-md"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="240">4 hours</option>
                <option value="480">8 hours</option>
                <option value="1440">24 hours</option>
              </select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Concurrent Sessions Limit</Label>
                <p class="text-xs text-neutral-muted">Maximum simultaneous sessions per user</p>
              </div>
              <select
                v-model="settings.authentication.maxConcurrentSessions"
                class="px-3 py-2 text-sm border border-input rounded-md"
              >
                <option value="1">1 session</option>
                <option value="3">3 sessions</option>
                <option value="5">5 sessions</option>
                <option value="10">10 sessions</option>
                <option value="-1">Unlimited</option>
              </select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Remember Me Duration</Label>
                <p class="text-xs text-neutral-muted">How long "Remember Me" sessions last</p>
              </div>
              <select
                v-model="settings.authentication.rememberMeDuration"
                class="px-3 py-2 text-sm border border-input rounded-md"
              >
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Two-Factor Authentication -->
        <div>
          <h3 class="font-medium mb-3">Two-Factor Authentication</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Require 2FA for All Users</Label>
                <p class="text-xs text-neutral-muted">Mandatory two-factor authentication</p>
              </div>
              <Checkbox v-model="settings.authentication.require2FA" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">2FA Grace Period</Label>
                <p class="text-xs text-neutral-muted">Days to set up 2FA before enforcement</p>
              </div>
              <select
                v-model="settings.authentication.twoFAGracePeriod"
                class="px-3 py-2 text-sm border border-input rounded-md"
                :disabled="!settings.authentication.require2FA"
              >
                <option value="0">Immediate</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
              </select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Allowed 2FA Methods</Label>
                <p class="text-xs text-neutral-muted">Which 2FA methods users can use</p>
              </div>
              <div class="space-y-2">
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="totp"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('totp')"
                    @update:checked="toggleTwoFAMethod('totp')"
                  />
                  <Label for="totp" class="text-sm">TOTP Apps (Google Authenticator, Authy)</Label>
                </div>
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="sms"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('sms')"
                    @update:checked="toggleTwoFAMethod('sms')"
                  />
                  <Label for="sms" class="text-sm">SMS Codes</Label>
                </div>
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="backup"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('backup')"
                    @update:checked="toggleTwoFAMethod('backup')"
                  />
                  <Label for="backup" class="text-sm">Backup Codes</Label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- API Security -->
    <Card>
      <CardHeader>
        <CardTitle>API Security</CardTitle>
        <CardDescription>Manage API keys and rate limiting</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- API Keys -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-medium">API Keys</h3>
            <Button size="sm" @click="createAPIKey">
              <Plus class="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>

          <div
            v-if="apiKeys.length === 0"
            class="text-center py-8 border-2 border-dashed border-muted rounded-lg"
          >
            <Key class="h-8 w-8 text-neutral-muted mx-auto mb-2" />
            <p class="text-sm text-neutral-muted">No API keys created yet</p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="key in apiKeys"
              :key="key.id"
              class="flex items-center justify-between p-3 border rounded-lg"
            >
              <div>
                <div class="font-medium">
                  {{ key.name }}
                </div>
                <div class="text-sm text-neutral-muted">
                  Created {{ formatDate(key.createdAt) }} • Last used
                  {{ formatDate(key.lastUsed) }}
                </div>
                <div class="font-mono text-xs bg-background-tertiary px-2 py-1 rounded mt-1">
                  {{ key.maskedKey }}
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <Badge :variant="key.status === 'active' ? 'success' : 'secondary'">
                  {{ key.status }}
                </Badge>
                <Button variant="ghost" size="sm" @click="toggleAPIKey(key.id)">
                  {{ key.status === "active" ? "Disable" : "Enable" }}
                </Button>
                <Button variant="ghost" size="sm" @click="deleteAPIKey(key.id)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Rate Limiting -->
        <div>
          <h3 class="font-medium mb-3">Rate Limiting</h3>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label for="rate-limit-requests">Requests per Minute</Label>
              <Input
                id="rate-limit-requests"
                v-model="settings.apiSecurity.rateLimiting.requestsPerMinute"
                type="number"
                min="1"
                max="10000"
                class="mt-1"
              />
              <p class="text-xs text-neutral-muted mt-1">
                Maximum API requests per minute per API key
              </p>
            </div>

            <div>
              <Label for="rate-limit-burst">Burst Limit</Label>
              <Input
                id="rate-limit-burst"
                v-model="settings.apiSecurity.rateLimiting.burstLimit"
                type="number"
                min="1"
                max="1000"
                class="mt-1"
              />
              <p class="text-xs text-neutral-muted mt-1">Maximum burst requests allowed</p>
            </div>
          </div>
        </div>

        <!-- IP Whitelist -->
        <div>
          <h3 class="font-medium mb-3">IP Address Whitelist</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">Enable IP Whitelist</Label>
                <p class="text-xs text-neutral-muted">Only allow API access from specified IPs</p>
              </div>
              <Checkbox v-model="settings.apiSecurity.ipWhitelist.enabled" />
            </div>

            <div v-if="settings.apiSecurity.ipWhitelist.enabled">
              <Label for="ip-addresses">Allowed IP Addresses</Label>
              <div class="space-y-2 mt-1">
                <div
                  v-for="(ip, index) in settings.apiSecurity.ipWhitelist.addresses"
                  :key="index"
                  class="flex items-center space-x-2"
                >
                  <Input
                    v-model="settings.apiSecurity.ipWhitelist.addresses[index]"
                    placeholder="192.168.1.1 or 192.168.1.0/24"
                    class="flex-1"
                  />
                  <Button variant="ghost" size="sm" @click="removeIPAddress(index)">
                    <X class="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" @click="addIPAddress">
                  <Plus class="h-4 w-4 mr-2" />
                  Add IP Address
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Login Attempts & Security Logs -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Recent Login Attempts -->
      <Card>
        <CardHeader>
          <CardTitle>Recent Login Attempts</CardTitle>
          <CardDescription>Monitor authentication activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div
              v-for="attempt in recentLoginAttempts"
              :key="attempt.id"
              class="flex items-center justify-between p-3 border rounded-lg"
            >
              <div class="flex items-center space-x-3">
                <div
                  :class="['w-2 h-2 rounded-full', attempt.success ? 'bg-green-500' : 'bg-red-500']"
                />
                <div>
                  <div class="font-medium">
                    {{ attempt.email }}
                  </div>
                  <div class="text-sm text-neutral-muted">
                    {{ attempt.ipAddress }} •
                    {{ formatDate(attempt.timestamp) }}
                  </div>
                </div>
              </div>
              <Badge :variant="attempt.success ? 'success' : 'destructive'">
                {{ attempt.success ? "Success" : "Failed" }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Security Events -->
      <Card>
        <CardHeader>
          <CardTitle>Security Events</CardTitle>
          <CardDescription>Important security-related events</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div
              v-for="event in securityEvents"
              :key="event.id"
              class="flex items-start space-x-3 p-3 border rounded-lg"
            >
              <component
                :is="getEventIcon(event.type)"
                :class="['h-4 w-4 mt-0.5', getEventIconColor(event.severity)]"
              />
              <div class="flex-1">
                <div class="font-medium">
                  {{ event.title }}
                </div>
                <div class="text-sm text-neutral-muted">
                  {{ event.description }}
                </div>
                <div class="text-xs text-neutral-muted">
                  {{ formatDate(event.timestamp) }}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Download,
  Save,
  Shield,
  Key,
  AlertTriangle,
  Plus,
  X,
  Trash2,
  Lock,
  UserX,
} from "lucide-vue-next";

// Reactive state
const originalSettings = ref({});
const settings = ref({
  authentication: {
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      expirationDays: 90,
    },
    sessionTimeout: 240, // minutes
    maxConcurrentSessions: 3,
    rememberMeDuration: 30, // days
    require2FA: false,
    twoFAGracePeriod: 7,
    allowedTwoFAMethods: ["totp", "backup"],
  },
  apiSecurity: {
    rateLimiting: {
      requestsPerMinute: 1000,
      burstLimit: 100,
    },
    ipWhitelist: {
      enabled: false,
      addresses: [""],
    },
  },
});

// Mock data - TODO: Replace with actual API calls
const securityScore = ref(85);
const activeSessions = ref(12);
const securityAlerts = ref(2);

const recommendations = ref([
  {
    id: "enable-2fa",
    title: "Enable Two-Factor Authentication",
    description: "Require 2FA for all users to improve account security",
  },
  {
    id: "update-password-policy",
    title: "Strengthen Password Policy",
    description: "Require special characters and increase minimum length to 12 characters",
  },
]);

const apiKeys = ref([
  {
    id: "1",
    name: "Production API Key",
    maskedKey: "hay_live_1234...7890",
    status: "active",
    createdAt: new Date("2024-01-01"),
    lastUsed: new Date("2024-01-15T14:30:00"),
  },
  {
    id: "2",
    name: "Development API Key",
    maskedKey: "hay_test_abcd...efgh",
    status: "active",
    createdAt: new Date("2024-01-10"),
    lastUsed: new Date("2024-01-14T10:20:00"),
  },
]);

const recentLoginAttempts = ref([
  {
    id: "1",
    email: "admin@example.com",
    ipAddress: "192.168.1.100",
    success: true,
    timestamp: new Date("2024-01-15T14:30:00"),
  },
  {
    id: "2",
    email: "user@example.com",
    ipAddress: "10.0.0.50",
    success: true,
    timestamp: new Date("2024-01-15T13:45:00"),
  },
  {
    id: "3",
    email: "hacker@malicious.com",
    ipAddress: "123.456.789.0",
    success: false,
    timestamp: new Date("2024-01-15T12:15:00"),
  },
]);

const securityEvents = ref([
  {
    id: "1",
    type: "failed_login",
    severity: "medium",
    title: "Multiple Failed Login Attempts",
    description: "User account locked after 5 failed attempts",
    timestamp: new Date("2024-01-15T12:15:00"),
  },
  {
    id: "2",
    type: "api_key_created",
    severity: "low",
    title: "New API Key Created",
    description: 'API key "Development API Key" was created',
    timestamp: new Date("2024-01-14T16:20:00"),
  },
  {
    id: "3",
    type: "password_changed",
    severity: "low",
    title: "Password Changed",
    description: "User admin@example.com changed their password",
    timestamp: new Date("2024-01-13T09:30:00"),
  },
]);

// Computed properties
const hasChanges = computed(() => {
  return JSON.stringify(settings.value) !== JSON.stringify(originalSettings.value);
});

// Methods
const formatDate = (date: Date) => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Today";
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return date.toLocaleDateString();
  }
};

const getEventIcon = (type: string) => {
  const icons = {
    failed_login: UserX,
    api_key_created: Key,
    password_changed: Lock,
    account_locked: Lock,
    suspicious_activity: AlertTriangle,
  };
  return icons[type as keyof typeof icons] || AlertTriangle;
};

const getEventIconColor = (severity: string) => {
  const colors = {
    low: "text-blue-600",
    medium: "text-yellow-600",
    high: "text-red-600",
    critical: "text-red-800",
  };
  return colors[severity as keyof typeof colors] || "text-gray-600";
};

const toggleTwoFAMethod = (method: string) => {
  const index = settings.value.authentication.allowedTwoFAMethods.indexOf(method);
  if (index > -1) {
    settings.value.authentication.allowedTwoFAMethods.splice(index, 1);
  } else {
    settings.value.authentication.allowedTwoFAMethods.push(method);
  }
};

const addIPAddress = () => {
  settings.value.apiSecurity.ipWhitelist.addresses.push("");
};

const removeIPAddress = (index: number) => {
  settings.value.apiSecurity.ipWhitelist.addresses.splice(index, 1);
};

const createAPIKey = () => {
  // TODO: Open API key creation modal
  console.log("Create new API key");
};

const toggleAPIKey = (keyId: string) => {
  const key = apiKeys.value.find((k) => k.id === keyId);
  if (key) {
    key.status = key.status === "active" ? "inactive" : "active";
  }
};

const deleteAPIKey = (keyId: string) => {
  if (confirm("Are you sure you want to delete this API key? This action cannot be undone.")) {
    const index = apiKeys.value.findIndex((k) => k.id === keyId);
    if (index > -1) {
      apiKeys.value.splice(index, 1);
    }
  }
};

const implementRecommendation = (recId: string) => {
  // TODO: Implement security recommendation
  console.log("Implement recommendation:", recId);

  // Remove from recommendations
  const index = recommendations.value.findIndex((r) => r.id === recId);
  if (index > -1) {
    recommendations.value.splice(index, 1);
  }
};

const saveSettings = async () => {
  try {
    // TODO: Save security settings to API
    console.log("Saving security settings:", settings.value);

    // Update original settings to new saved state
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));

    // TODO: Show success toast
    console.log("Security settings saved successfully");
  } catch (error) {
    // TODO: Show error toast
    console.error("Failed to save security settings:", error);
  }
};

const downloadSecurityReport = () => {
  // TODO: Generate and download security report
  console.log("Download security report");
};

// Lifecycle
onMounted(async () => {
  // TODO: Load current security settings from API
  // const currentSettings = await fetchSecuritySettings()
  // settings.value = currentSettings

  // Store original settings for change detection
  originalSettings.value = JSON.parse(JSON.stringify(settings.value));
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Security Settings - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage authentication, access controls, and security policies",
    },
  ],
});
</script>
