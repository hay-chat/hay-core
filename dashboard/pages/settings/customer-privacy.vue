<template>
  <Page :title="$t('customerPrivacy.title')" :description="$t('customerPrivacy.description')">
    <!-- Info Alert -->
    <Alert class="mb-6">
      <AlertTitle>{{ $t('customerPrivacy.infoTitle') }}</AlertTitle>
      <AlertDescription>
        {{ $t('customerPrivacy.infoDescription') }}
      </AlertDescription>
    </Alert>

    <!-- Error Alert -->
    <Alert v-if="errorState.type" variant="destructive" class="mb-6">
      <AlertTitle>
        {{ errorState.type === "rate_limit" ? $t('customerPrivacy.tooManyRequests') : $t('customerPrivacy.error') }}
      </AlertTitle>
      <AlertDescription>
        {{ errorState.message }}
        <div v-if="errorState.retryAfter" class="mt-2 font-medium">
          {{ $t('customerPrivacy.tryAgainAfter', { time: formatTime(errorState.retryAfter) }) }}
        </div>
        <div v-if="errorState.type === 'email_failed'" class="mt-2">
          {{ $t('customerPrivacy.checkSpamFolder') }}
        </div>
      </AlertDescription>
      <Button
        v-if="errorState.type !== 'rate_limit'"
        variant="outline"
        size="sm"
        class="mt-2"
        @click="errorState = { type: null, message: '' }"
      >
        {{ $t('customerPrivacy.dismiss') }}
      </Button>
    </Alert>

    <!-- Data Retention Policy -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t('customerPrivacy.dataRetentionPolicy') }}</CardTitle>
        <CardDescription>
          {{ $t('customerPrivacy.dataRetentionPolicyDescription') }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="retentionDays">{{ $t('customerPrivacy.retentionPeriod') }}</Label>
          <Select v-model="retentionDays" id="retentionDays">
            <SelectTrigger>
              <SelectValue :placeholder="$t('customerPrivacy.selectRetentionPeriod')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="null">{{ $t('customerPrivacy.retentionDisabled') }}</SelectItem>
              <SelectItem :value="30">{{ $t('customerPrivacy.retentionDays', { days: 30 }) }}</SelectItem>
              <SelectItem :value="60">{{ $t('customerPrivacy.retentionDays', { days: 60 }) }}</SelectItem>
              <SelectItem :value="90">{{ $t('customerPrivacy.retentionDays', { days: 90 }) }}</SelectItem>
              <SelectItem :value="180">{{ $t('customerPrivacy.retentionDays', { days: 180 }) }}</SelectItem>
              <SelectItem :value="365">{{ $t('customerPrivacy.retentionYear') }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-sm text-muted-foreground">
            {{ $t('customerPrivacy.retentionHelp') }}
          </p>
        </div>

        <div
          class="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg"
        >
          <div class="flex items-start space-x-2">
            <AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div class="text-sm">
              <p class="font-medium text-amber-800 dark:text-amber-200">{{ $t('customerPrivacy.retentionImportant') }}</p>
              <p class="text-amber-700 dark:text-amber-300">
                {{ $t('customerPrivacy.retentionWarning') }}
              </p>
            </div>
          </div>
        </div>

        <Button @click="saveRetentionPolicy" :disabled="isSavingRetention">
          <Save class="h-4 w-4 mr-2" />
          {{ isSavingRetention ? $t('customerPrivacy.saving') : $t('customerPrivacy.saveRetentionPolicy') }}
        </Button>
      </CardContent>
    </Card>

    <!-- Initiate Request Form -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t('customerPrivacy.initiateRequest') }}</CardTitle>
        <CardDescription>
          {{ $t('customerPrivacy.initiateRequestDescription') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="initiateRequest" class="space-y-4">
          <!-- Identifier Type Selector -->
          <div class="space-y-2">
            <Label for="identifierType">{{ $t('customerPrivacy.identifyCustomerBy') }}</Label>
            <Select v-model="identifierType" id="identifierType">
              <SelectTrigger>
                <SelectValue :placeholder="$t('customerPrivacy.selectIdentifierType')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{{ $t('customerPrivacy.identifierEmail') }}</SelectItem>
                <SelectItem value="phone">{{ $t('customerPrivacy.identifierPhone') }}</SelectItem>
                <SelectItem value="externalId">{{ $t('customerPrivacy.identifierExternalId') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Identifier Value Input -->
          <div class="space-y-2">
            <Label for="identifierValue">{{ identifierLabel }}</Label>
            <Input
              id="identifierValue"
              v-model="identifierValue"
              :placeholder="identifierPlaceholder"
              :type="identifierType === 'email' ? 'email' : 'text'"
              required
            />
          </div>

          <!-- Request Type Buttons -->
          <div class="flex gap-3">
            <Button
              type="submit"
              :disabled="isLoading || !identifierValue"
              @click="requestType = 'export'"
              class="flex-1"
            >
              <Download class="h-4 w-4 mr-2" />
              {{ $t('customerPrivacy.requestDataExport') }}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              :disabled="isLoading || !identifierValue"
              @click="requestType = 'deletion'"
              class="flex-1"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              {{ $t('customerPrivacy.requestDataDeletion') }}
            </Button>
          </div>

          <!-- Loading State -->
          <div v-if="isLoading" class="flex items-center justify-center py-4">
            <Loader2 class="h-6 w-6 animate-spin text-neutral-muted" />
            <span class="ml-2 text-sm text-neutral-muted">{{ $t('customerPrivacy.processingRequest') }}</span>
          </div>

          <!-- Success/Error Messages -->
          <Alert v-if="successMessage" variant="default" class="border-green-200 bg-green-50">
            <CheckCircle class="h-4 w-4 text-green-600" />
            <AlertDescription class="text-green-800">
              {{ successMessage }}
            </AlertDescription>
          </Alert>

          <Alert v-if="errorMessage" variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>
        </form>
      </CardContent>
    </Card>

    <!-- Request History -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t('customerPrivacy.requestHistory') }}</CardTitle>
        <CardDescription>
          {{ $t('customerPrivacy.requestHistoryDescription') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomerPrivacyRequestsTable
          :requests="requests"
          :loading="tableLoading"
          @refresh="fetchRequests"
        />
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Hay } from "@/utils/api";
import {
  Download,
  Trash2,
  InfoIcon,
  AlertCircle,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Save,
} from "lucide-vue-next";
import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const toast = useToast();
import CustomerPrivacyRequestsTable from "@/components/CustomerPrivacyRequestsTable.vue";

// Retention policy state
const retentionDays = ref<number | null>(null);
const isSavingRetention = ref(false);

// Form state
const identifierType = ref<"email" | "phone" | "externalId">("email");
const identifierValue = ref("");
const requestType = ref<"export" | "deletion">("export");
const isLoading = ref(false);
const successMessage = ref("");
const errorMessage = ref("");

// Error state management
const errorState = ref<{
  type: "network" | "rate_limit" | "service_unavailable" | "email_failed" | null;
  message: string;
  retryAfter?: Date;
}>({ type: null, message: "" });

// Table state
const requests = ref<unknown[]>([]);
const tableLoading = ref(false);

// Extract retry time from error message
const extractRetryTime = (message: string): Date | undefined => {
  const match = message.match(/try again (?:after|in) (\d+) (second|minute|hour)s?/i);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const now = new Date();

    switch (unit) {
      case "second":
        return new Date(now.getTime() + value * 1000);
      case "minute":
        return new Date(now.getTime() + value * 60 * 1000);
      case "hour":
        return new Date(now.getTime() + value * 60 * 60 * 1000);
    }
  }
  return undefined;
};

// Format retry time
const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Computed properties
const identifierLabel = computed(() => {
  switch (identifierType.value) {
    case "email":
      return t('customerPrivacy.customerEmailAddress');
    case "phone":
      return t('customerPrivacy.customerPhoneNumber');
    case "externalId":
      return t('customerPrivacy.externalCustomerId');
    default:
      return t('customerPrivacy.customerIdentifier');
  }
});

const identifierPlaceholder = computed(() => {
  switch (identifierType.value) {
    case "email":
      return t('customerPrivacy.emailPlaceholder');
    case "phone":
      return t('customerPrivacy.phonePlaceholder');
    case "externalId":
      return t('customerPrivacy.externalIdPlaceholder');
    default:
      return t('customerPrivacy.identifierPlaceholder');
  }
});

// Handle API errors
const handleApiError = (error: unknown): void => {
  const err = error as {
    data?: { code?: string };
    code?: string;
    message?: string;
    error?: { message?: string };
  };
  console.error("Privacy request error:", err);

  // Clear previous states
  errorState.value = { type: null, message: "" };
  errorMessage.value = "";

  const errorCode = err.data?.code || err.code;
  const errMessage = err.message || err.error?.message || "An error occurred";

  if (errorCode === "TOO_MANY_REQUESTS" || errMessage.toLowerCase().includes("rate limit")) {
    errorState.value = {
      type: "rate_limit",
      message: errMessage,
      retryAfter: extractRetryTime(errMessage),
    };
    errorMessage.value = errMessage;
  } else if (
    errorCode === "SERVICE_UNAVAILABLE" ||
    errMessage.toLowerCase().includes("unavailable")
  ) {
    errorState.value = {
      type: "service_unavailable",
      message: "Privacy service is temporarily unavailable. Please try again in a few minutes.",
    };
    errorMessage.value =
      "Privacy service is temporarily unavailable. Please try again in a few minutes.";
  } else if (
    errMessage.toLowerCase().includes("verification email") ||
    errMessage.toLowerCase().includes("email")
  ) {
    errorState.value = {
      type: "email_failed",
      message: errMessage,
    };
    errorMessage.value = errMessage;
  } else {
    errorState.value = {
      type: "network",
      message: errMessage,
    };
    errorMessage.value = errMessage || "Failed to initiate privacy request. Please try again.";
  }
};

// Methods
const initiateRequest = async () => {
  if (!identifierValue.value) return;

  isLoading.value = true;
  successMessage.value = "";
  errorMessage.value = "";
  errorState.value = { type: null, message: "" };

  try {
    if (requestType.value === "export") {
      const result = await Hay.customerPrivacy.requestExport.mutate({
        identifier: {
          type: identifierType.value,
          value: identifierValue.value,
        },
      });

      successMessage.value = result.message;
    } else {
      const result = await Hay.customerPrivacy.requestDeletion.mutate({
        identifier: {
          type: identifierType.value,
          value: identifierValue.value,
        },
      });

      successMessage.value = result.message;
    }

    // Clear form
    identifierValue.value = "";

    // Refresh request list
    await fetchRequests();
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    isLoading.value = false;
  }
};

const fetchRequests = async () => {
  tableLoading.value = true;
  try {
    const result = await Hay.customerPrivacy.listRequests.query({
      page: 1,
      limit: 50,
    });

    requests.value = result.requests;
  } catch (error) {
    console.error("Failed to fetch privacy requests:", error);
  } finally {
    tableLoading.value = false;
  }
};

// Retention policy methods
const fetchRetentionPolicy = async () => {
  try {
    const result = await Hay.organizations.getSettings.query();
    retentionDays.value = result.retentionDays ?? null;
  } catch (error) {
    console.error("Failed to fetch retention policy:", error);
  }
};

const saveRetentionPolicy = async () => {
  isSavingRetention.value = true;
  try {
    await Hay.organizations.updateSettings.mutate({
      retentionDays: retentionDays.value,
    });
    toast.success(t('customerPrivacy.retentionSaveSuccess'));
  } catch (error) {
    console.error("Failed to save retention policy:", error);
    toast.error(t('customerPrivacy.retentionSaveFailed'));
  } finally {
    isSavingRetention.value = false;
  }
};

// Lifecycle
onMounted(() => {
  fetchRequests();
  fetchRetentionPolicy();
});
</script>
