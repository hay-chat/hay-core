<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ $t("security.title") }}</h1>
        <p class="text-neutral-muted">
          {{ $t("security.description") }}
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="downloadSecurityReport">
          <Download class="h-4 w-4 mr-2" />
          {{ $t("security.securityReport") }}
        </Button>
        <Button :loading="isSaving" :disabled="!hasChanges" @click="saveSettings">
          <Save class="h-4 w-4 mr-2" />
          {{ $t("security.saveChanges") }}
        </Button>
      </div>
    </div>

    <!-- Security Overview -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("security.securityOverview") }}</CardTitle>
        <CardDescription>{{ $t("security.securityOverviewDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Shield class="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div class="font-medium">{{ $t("security.securityScore") }}</div>
              <div class="text-2xl font-bold text-green-600">{{ securityScore }}/100</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Key class="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div class="font-medium">{{ $t("security.activeSessions") }}</div>
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
              <div class="font-medium">{{ $t("security.securityAlerts") }}</div>
              <div class="text-2xl font-bold">
                {{ securityAlerts }}
              </div>
            </div>
          </div>
        </div>

        <!-- Security Recommendations -->
        <div v-if="recommendations.length > 0" class="mt-6">
          <h3 class="font-medium mb-3">{{ $t("security.securityRecommendations") }}</h3>
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
                {{ $t("security.fix") }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Authentication Settings -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("security.authentication") }}</CardTitle>
        <CardDescription>{{ $t("security.authenticationDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- Password Requirements -->
        <div>
          <h3 class="font-medium mb-3">{{ $t("security.passwordRequirements") }}</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.minimumLength") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.minimumLengthDescription") }}
                </p>
              </div>
              <Select v-model="settings.authentication.passwordPolicy.minLength">
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.minimumLength')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="8">{{ $t("security.characters", { count: 8 }) }}</SelectItem>
                  <SelectItem :value="10">{{
                    $t("security.characters", { count: 10 })
                  }}</SelectItem>
                  <SelectItem :value="12">{{
                    $t("security.characters", { count: 12 })
                  }}</SelectItem>
                  <SelectItem :value="16">{{
                    $t("security.characters", { count: 16 })
                  }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.requireUppercase") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.requireUppercaseDescription") }}
                </p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireUppercase" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.requireNumbers") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.requireNumbersDescription") }}
                </p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireNumbers" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.requireSpecialChars") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.requireSpecialCharsDescription") }}
                </p>
              </div>
              <Checkbox v-model="settings.authentication.passwordPolicy.requireSpecialChars" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.passwordExpiration") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.passwordExpirationDescription") }}
                </p>
              </div>
              <Select v-model="settings.authentication.passwordPolicy.expirationDays">
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.passwordExpiration')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="0">{{ $t("security.expirationNever") }}</SelectItem>
                  <SelectItem :value="30">{{
                    $t("security.expirationDays", { days: 30 })
                  }}</SelectItem>
                  <SelectItem :value="60">{{
                    $t("security.expirationDays", { days: 60 })
                  }}</SelectItem>
                  <SelectItem :value="90">{{
                    $t("security.expirationDays", { days: 90 })
                  }}</SelectItem>
                  <SelectItem :value="180">{{
                    $t("security.expirationDays", { days: 180 })
                  }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <!-- Session Management -->
        <div>
          <h3 class="font-medium mb-3">{{ $t("security.sessionManagement") }}</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.sessionTimeout") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.sessionTimeoutDescription") }}
                </p>
              </div>
              <Select v-model="settings.authentication.sessionTimeout">
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.sessionTimeout')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="15">{{ $t("security.timeout15min") }}</SelectItem>
                  <SelectItem :value="30">{{ $t("security.timeout30min") }}</SelectItem>
                  <SelectItem :value="60">{{ $t("security.timeout1h") }}</SelectItem>
                  <SelectItem :value="240">{{ $t("security.timeout4h") }}</SelectItem>
                  <SelectItem :value="480">{{ $t("security.timeout8h") }}</SelectItem>
                  <SelectItem :value="1440">{{ $t("security.timeout24h") }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.concurrentSessions") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.concurrentSessionsDescription") }}
                </p>
              </div>
              <Select v-model="settings.authentication.maxConcurrentSessions">
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.concurrentSessions')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="1">{{ $t("security.session1") }}</SelectItem>
                  <SelectItem :value="3">{{ $t("security.sessions", { count: 3 }) }}</SelectItem>
                  <SelectItem :value="5">{{ $t("security.sessions", { count: 5 }) }}</SelectItem>
                  <SelectItem :value="10">{{ $t("security.sessions", { count: 10 }) }}</SelectItem>
                  <SelectItem :value="-1">{{ $t("security.sessionsUnlimited") }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.rememberMeDuration") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.rememberMeDurationDescription") }}
                </p>
              </div>
              <Select v-model="settings.authentication.rememberMeDuration">
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.rememberMeDuration')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="7">{{ $t("security.days", { count: 7 }) }}</SelectItem>
                  <SelectItem :value="14">{{ $t("security.days", { count: 14 }) }}</SelectItem>
                  <SelectItem :value="30">{{ $t("security.days", { count: 30 }) }}</SelectItem>
                  <SelectItem :value="90">{{ $t("security.days", { count: 90 }) }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <!-- Two-Factor Authentication -->
        <div>
          <h3 class="font-medium mb-3">{{ $t("security.twoFactorAuth") }}</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.require2FA") }}</Label>
                <p class="text-xs text-neutral-muted">{{ $t("security.require2FADescription") }}</p>
              </div>
              <Checkbox v-model="settings.authentication.require2FA" />
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.gracePeriod") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.gracePeriodDescription") }}
                </p>
              </div>
              <Select
                v-model="settings.authentication.twoFAGracePeriod"
                :disabled="!settings.authentication.require2FA"
              >
                <SelectTrigger class="w-40">
                  <SelectValue :placeholder="$t('security.gracePeriod')" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="0">{{ $t("security.immediate") }}</SelectItem>
                  <SelectItem :value="3">{{ $t("security.days", { count: 3 }) }}</SelectItem>
                  <SelectItem :value="7">{{ $t("security.days", { count: 7 }) }}</SelectItem>
                  <SelectItem :value="14">{{ $t("security.days", { count: 14 }) }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.allowed2FAMethods") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.allowed2FAMethodsDescription") }}
                </p>
              </div>
              <div class="space-y-2">
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="totp"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('totp')"
                    @update:checked="toggleTwoFAMethod('totp')"
                  />
                  <Label for="totp" class="text-sm">{{ $t("security.totpApps") }}</Label>
                </div>
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="sms"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('sms')"
                    @update:checked="toggleTwoFAMethod('sms')"
                  />
                  <Label for="sms" class="text-sm">{{ $t("security.smsCodes") }}</Label>
                </div>
                <div class="flex items-center space-x-2">
                  <Checkbox
                    id="backup"
                    :checked="settings.authentication.allowedTwoFAMethods.includes('backup')"
                    @update:checked="toggleTwoFAMethod('backup')"
                  />
                  <Label for="backup" class="text-sm">{{ $t("security.backupCodes") }}</Label>
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
        <CardTitle>{{ $t("security.apiSecurity") }}</CardTitle>
        <CardDescription>{{ $t("security.apiSecurityDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- API Keys -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-medium">{{ $t("security.apiKeys") }}</h3>
            <Button size="sm" @click="createAPIKey">
              <Plus class="h-4 w-4 mr-2" />
              {{ $t("security.createApiKey") }}
            </Button>
          </div>

          <div
            v-if="apiKeys.length === 0"
            class="text-center py-8 border-2 border-dashed border-muted rounded-lg"
          >
            <Key class="h-8 w-8 text-neutral-muted mx-auto mb-2" />
            <p class="text-sm text-neutral-muted">{{ $t("security.noApiKeys") }}</p>
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
                  {{ key.status === "active" ? $t("security.disable") : $t("security.enable") }}
                </Button>
                <Button variant="ghost" size="sm" @click="openDeleteKeyDialog(key.id)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Rate Limiting -->
        <div>
          <h3 class="font-medium mb-3">{{ $t("security.rateLimiting") }}</h3>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label for="rate-limit-requests">{{ $t("security.requestsPerMinute") }}</Label>
              <Input
                id="rate-limit-requests"
                v-model="settings.apiSecurity.rateLimiting.requestsPerMinute"
                type="number"
                min="1"
                max="10000"
                class="mt-1"
              />
              <p class="text-xs text-neutral-muted mt-1">
                {{ $t("security.requestsPerMinuteDescription") }}
              </p>
            </div>

            <div>
              <Label for="rate-limit-burst">{{ $t("security.burstLimit") }}</Label>
              <Input
                id="rate-limit-burst"
                v-model="settings.apiSecurity.rateLimiting.burstLimit"
                type="number"
                min="1"
                max="1000"
                class="mt-1"
              />
              <p class="text-xs text-neutral-muted mt-1">
                {{ $t("security.burstLimitDescription") }}
              </p>
            </div>
          </div>
        </div>

        <!-- IP Whitelist -->
        <div>
          <h3 class="font-medium mb-3">{{ $t("security.ipWhitelist") }}</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label class="font-normal">{{ $t("security.enableIpWhitelist") }}</Label>
                <p class="text-xs text-neutral-muted">
                  {{ $t("security.enableIpWhitelistDescription") }}
                </p>
              </div>
              <Checkbox v-model="settings.apiSecurity.ipWhitelist.enabled" />
            </div>

            <div v-if="settings.apiSecurity.ipWhitelist.enabled">
              <Label for="ip-addresses">{{ $t("security.allowedIpAddresses") }}</Label>
              <div class="space-y-2 mt-1">
                <div
                  v-for="(ip, index) in settings.apiSecurity.ipWhitelist.addresses"
                  :key="index"
                  class="flex items-center space-x-2"
                >
                  <Input
                    v-model="settings.apiSecurity.ipWhitelist.addresses[index]"
                    :placeholder="$t('security.ipPlaceholder')"
                    class="flex-1"
                  />
                  <Button variant="ghost" size="sm" @click="removeIPAddress(index)">
                    <X class="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" @click="addIPAddress">
                  <Plus class="h-4 w-4 mr-2" />
                  {{ $t("security.addIpAddress") }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Login Attempts & Security Logs -->
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Recent Login Attempts -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("security.recentLoginAttempts") }}</CardTitle>
          <CardDescription>{{ $t("security.recentLoginAttemptsDescription") }}</CardDescription>
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
                {{ attempt.success ? $t("security.success") : $t("security.failed") }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Security Events -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("security.securityEvents") }}</CardTitle>
          <CardDescription>{{ $t("security.securityEventsDescription") }}</CardDescription>
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

  <!-- Delete API Key Confirmation Dialog -->
  <ConfirmDialog
    v-model:open="deleteKeyDialogOpen"
    :title="$t('security.deleteApiKeyTitle')"
    :description="$t('security.deleteApiKeyDescription')"
    :confirm-text="$t('security.deleteApiKeyConfirm')"
    :destructive="true"
    @confirm="confirmDeleteAPIKey"
  />
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

const { t } = useI18n();
const { formatDate } = useOrgDateTime();

// Reactive state
const originalSettings = ref({});
const isSaving = ref(false);
const deleteKeyDialogOpen = ref(false);
const keyToDelete = ref<string | null>(null);
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

const openDeleteKeyDialog = (keyId: string) => {
  keyToDelete.value = keyId;
  deleteKeyDialogOpen.value = true;
};

const confirmDeleteAPIKey = () => {
  if (!keyToDelete.value) return;

  const index = apiKeys.value.findIndex((k) => k.id === keyToDelete.value);
  if (index > -1) {
    apiKeys.value.splice(index, 1);
  }

  keyToDelete.value = null;
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
    isSaving.value = true;
    // TODO: Save security settings to API
    console.log("Saving security settings:", settings.value);

    // Update original settings to new saved state
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));

    // TODO: Show success toast
    console.log("Security settings saved successfully");
  } catch (error) {
    // TODO: Show error toast
    console.error("Failed to save security settings:", error);
  } finally {
    isSaving.value = false;
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
  title: t("security.headTitle"),
  meta: [
    {
      name: "description",
      content: t("security.headDescription"),
    },
  ],
});
</script>
