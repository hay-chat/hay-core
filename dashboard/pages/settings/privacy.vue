<template>
  <Page :title="$t('privacy.title')" :description="$t('privacy.description')">
    <!-- Privacy Overview -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("privacy.yourRights") }}</CardTitle>
        <CardDescription>
          {{ $t("privacy.yourRightsDescription") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Download class="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div class="font-medium">{{ $t("privacy.dataExport") }}</div>
              <div class="text-sm text-neutral-muted">{{ $t("privacy.downloadYourData") }}</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <Trash2 class="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <div class="font-medium">{{ $t("privacy.dataDeletion") }}</div>
              <div class="text-sm text-neutral-muted">{{ $t("privacy.deleteYourAccount") }}</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Shield class="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div class="font-medium">{{ $t("privacy.privacyProtected") }}</div>
              <div class="text-sm text-neutral-muted">{{ $t("privacy.gdprCompliant") }}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Active Privacy Requests -->
    <Card v-if="activeRequests.length > 0">
      <CardHeader>
        <CardTitle>{{ $t("privacy.activeRequests") }}</CardTitle>
        <CardDescription>{{ $t("privacy.activeRequestsDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="request in activeRequests"
            :key="request.id"
            class="flex items-center justify-between p-4 border rounded-lg"
          >
            <div class="flex items-center space-x-4">
              <div
                :class="{
                  'bg-blue-100': request.type === 'export',
                  'bg-red-100': request.type === 'deletion',
                }"
                class="w-10 h-10 rounded-full flex items-center justify-center"
              >
                <Download v-if="request.type === 'export'" class="h-5 w-5 text-blue-600" />
                <Trash2 v-else class="h-5 w-5 text-red-600" />
              </div>
              <div>
                <div class="font-medium capitalize">
                  {{
                    request.type === "export"
                      ? $t("privacy.exportRequest")
                      : $t("privacy.deletionRequest")
                  }}
                </div>
                <div class="text-sm text-neutral-muted">
                  {{ formatStatus(request.status) }} •
                  {{ formatDate(request.createdAt) }}
                </div>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge :variant="getStatusVariant(request.status)">
                {{ request.status }}
              </Badge>
              <Button
                v-if="request.status === 'completed' && request.type === 'export'"
                variant="outline"
                size="sm"
                @click="downloadExport(request.id)"
              >
                <Download class="h-4 w-4 mr-2" />
                {{ $t("privacy.download") }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Error Alert -->
    <Alert v-if="errorState.type" variant="destructive" class="mb-6">
      <AlertTitle>
        {{ errorState.type === "rate_limit" ? $t("privacy.tooManyRequests") : $t("privacy.error") }}
      </AlertTitle>
      <AlertDescription>
        {{ errorState.message }}
        <div v-if="errorState.retryAfter" class="mt-2 font-medium">
          {{ $t("privacy.tryAgainAfter", { time: formatTime(errorState.retryAfter) }) }}
        </div>
        <div v-if="errorState.type === 'email_failed'" class="mt-2">
          {{ $t("privacy.checkSpamFolder") }}
        </div>
      </AlertDescription>
      <Button
        v-if="errorState.type !== 'rate_limit'"
        variant="outline"
        size="sm"
        class="mt-2"
        @click="errorState = { type: null, message: '' }"
      >
        {{ $t("privacy.dismiss") }}
      </Button>
    </Alert>

    <!-- Data Export Section -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("privacy.exportYourData") }}</CardTitle>
        <CardDescription>
          {{ $t("privacy.exportYourDataDescription") }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <h4 class="font-medium">{{ $t("privacy.exportIncluded") }}</h4>
          <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
            <li>{{ $t("privacy.exportItem1") }}</li>
            <li>{{ $t("privacy.exportItem2") }}</li>
            <li>{{ $t("privacy.exportItem3") }}</li>
            <li>{{ $t("privacy.exportItem4") }}</li>
            <li>{{ $t("privacy.exportItem5") }}</li>
          </ul>
        </div>

        <Alert>
          <AlertTitle>{{ $t("privacy.processingTime") }}</AlertTitle>
          <AlertDescription>
            {{ $t("privacy.processingTimeDescription") }}
          </AlertDescription>
        </Alert>

        <Button
          :loading="exportLoading"
          :disabled="errorState.type === 'rate_limit'"
          class="w-full sm:w-auto"
          @click="requestExport"
        >
          <Download class="h-4 w-4 mr-2" />
          {{ $t("privacy.requestDataExport") }}
        </Button>
      </CardContent>
    </Card>

    <!-- Data Deletion Section -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("privacy.deleteYourAccountTitle") }}</CardTitle>
        <CardDescription>{{ $t("privacy.deleteYourAccountDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>{{ $t("privacy.warningIrreversible") }}</AlertTitle>
          <AlertDescription>
            {{ $t("privacy.deleteWarningDescription") }}
          </AlertDescription>
        </Alert>

        <div class="space-y-2">
          <h4 class="font-medium">{{ $t("privacy.whatWillBeDeleted") }}</h4>
          <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
            <li>{{ $t("privacy.deleteItem1") }}</li>
            <li>{{ $t("privacy.deleteItem2") }}</li>
            <li>{{ $t("privacy.deleteItem3") }}</li>
            <li>{{ $t("privacy.deleteItem4") }}</li>
          </ul>
        </div>

        <Button
          variant="destructive"
          :loading="deleteLoading"
          class="w-full sm:w-auto"
          @click="showDeleteConfirmation = true"
        >
          <Trash2 class="h-4 w-4 mr-2" />
          {{ $t("privacy.deleteMyAccount") }}
        </Button>
      </CardContent>
    </Card>

    <!-- Privacy Policy Link -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("privacy.privacyInformation") }}</CardTitle>
        <CardDescription>{{ $t("privacy.privacyInformationDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-center justify-between p-3 border rounded-lg">
          <div class="flex items-center space-x-3">
            <FileText class="h-5 w-5 text-neutral-muted" />
            <div>
              <div class="font-medium">{{ $t("privacy.privacyPolicy") }}</div>
              <div class="text-sm text-neutral-muted">
                {{ $t("privacy.privacyPolicyDescription") }}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" as="a" href="/privacy-policy" target="_blank">
            <ExternalLink class="h-4 w-4" />
          </Button>
        </div>

        <div class="flex items-center justify-between p-3 border rounded-lg">
          <div class="flex items-center space-x-3">
            <Shield class="h-5 w-5 text-neutral-muted" />
            <div>
              <div class="font-medium">{{ $t("privacy.dataRetentionPolicy") }}</div>
              <div class="text-sm text-neutral-muted">
                {{ $t("privacy.dataRetentionPolicyDescription") }}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" as="a" href="/retention-policy" target="_blank">
            <ExternalLink class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Delete Confirmation Dialog -->
    <Dialog v-model:open="showDeleteConfirmation">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("privacy.deleteConfirmTitle") }}</DialogTitle>
          <DialogDescription>
            {{ $t("privacy.deleteConfirmDescription") }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <Alert variant="destructive" :icon="AlertTriangle">
            <AlertTitle>{{ $t("privacy.finalWarning") }}</AlertTitle>
            <AlertDescription>
              {{ $t("privacy.finalWarningDescription") }}
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <Label>{{ $t("privacy.typeDeleteConfirm") }}</Label>
            <Input v-model="deleteConfirmation" placeholder="DELETE" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showDeleteConfirmation = false">{{
            $t("users.cancel")
          }}</Button>
          <Button
            variant="destructive"
            :disabled="deleteConfirmation !== 'DELETE'"
            :loading="deleteLoading"
            @click="confirmDelete"
          >
            {{ $t("privacy.yesDeleteMyAccount") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Success Dialog -->
    <Dialog v-model:open="showSuccessDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ successTitle }}</DialogTitle>
          <DialogDescription>{{ successMessage }}</DialogDescription>
        </DialogHeader>

        <Alert :icon="Mail">
          <AlertTitle>{{ $t("privacy.checkYourEmail") }}</AlertTitle>
          <AlertDescription>
            {{ $t("privacy.checkYourEmailDescription", { email: user?.email }) }}
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button @click="showSuccessDialog = false">{{ $t("privacy.ok") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import {
  Download,
  Trash2,
  Shield,
  AlertTriangle,
  FileText,
  ExternalLink,
  Mail,
} from "lucide-vue-next";

import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const userStore = useUserStore();
const { toast } = useToast();
const { formatDate, formatTime } = useOrgDateTime();

const user = computed(() => userStore.user);
const exportLoading = ref(false);
const deleteLoading = ref(false);
const showDeleteConfirmation = ref(false);
const showSuccessDialog = ref(false);
const deleteConfirmation = ref("");
const successTitle = ref("");
const successMessage = ref("");
interface PrivacyRequest {
  id: string;
  type: "export" | "deletion";
  status: string;
  createdAt: string | Date;
}

const activeRequests = ref<PrivacyRequest[]>([]);

// Error state management
const errorState = ref<{
  type: "network" | "rate_limit" | "invalid_token" | "service_unavailable" | "email_failed" | null;
  message: string;
  retryAfter?: Date;
}>({ type: null, message: "" });

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

// formatTime is provided by useOrgDateTime()

// Handle API errors
const handleApiError = (error: unknown): void => {
  const err = error as {
    data?: { code?: string };
    code?: string;
    message?: string;
    error?: { message?: string };
  };
  console.error("Privacy request error:", err);

  // Clear previous error state
  errorState.value = { type: null, message: "" };

  // Check for tRPC error codes
  const errorCode = err.data?.code || err.code;
  const errorMessage = err.message || err.error?.message || "An error occurred";

  if (errorCode === "TOO_MANY_REQUESTS" || errorMessage.toLowerCase().includes("rate limit")) {
    errorState.value = {
      type: "rate_limit",
      message: errorMessage,
      retryAfter: extractRetryTime(errorMessage),
    };
  } else if (
    errorCode === "SERVICE_UNAVAILABLE" ||
    errorMessage.toLowerCase().includes("unavailable")
  ) {
    errorState.value = {
      type: "service_unavailable",
      message: "Privacy service is temporarily unavailable. Please try again in a few minutes.",
    };
  } else if (
    errorMessage.toLowerCase().includes("verification email") ||
    errorMessage.toLowerCase().includes("email")
  ) {
    errorState.value = {
      type: "email_failed",
      message: errorMessage,
    };
  } else if (
    errorMessage.toLowerCase().includes("network") ||
    errorMessage.toLowerCase().includes("connection")
  ) {
    errorState.value = {
      type: "network",
      message: "Network error. Please check your connection and try again.",
    };
  } else {
    errorState.value = {
      type: "network",
      message: errorMessage || "An error occurred. Please try again.",
    };
  }
};

// Request data export
const requestExport = async () => {
  if (!user.value?.email) {
    toast.error(t("privacy.error"), t("privacy.userEmailNotFound"));
    return;
  }

  try {
    exportLoading.value = true;
    errorState.value = { type: null, message: "" };

    const result = await Hay.privacy.requestExport.mutate({
      email: user.value.email,
    });

    successTitle.value = t("privacy.dataExportRequested");
    successMessage.value = result.message;
    showSuccessDialog.value = true;

    // Refresh active requests
    await loadActiveRequests();
  } catch (error: unknown) {
    handleApiError(error);
  } finally {
    exportLoading.value = false;
  }
};

// Show delete confirmation dialog
const confirmDelete = async () => {
  if (!user.value?.email || deleteConfirmation.value !== "DELETE") {
    return;
  }

  try {
    deleteLoading.value = true;
    errorState.value = { type: null, message: "" };

    const result = await Hay.privacy.requestDeletion.mutate({
      email: user.value.email,
    });

    showDeleteConfirmation.value = false;
    deleteConfirmation.value = "";

    successTitle.value = t("privacy.accountDeletionRequested");
    successMessage.value = result.message;
    showSuccessDialog.value = true;

    // Refresh active requests
    await loadActiveRequests();
  } catch (error: unknown) {
    showDeleteConfirmation.value = false;
    handleApiError(error);
  } finally {
    deleteLoading.value = false;
  }
};

// Download completed export
const downloadExport = async (_requestId: string) => {
  try {
    // In a real implementation, you would get the download token from the email
    // For now, we'll show a message
    toast.info(t("privacy.downloadReady"), t("privacy.downloadReadyDescription"));
  } catch (error: unknown) {
    const err = error as { message?: string };
    toast.error(t("privacy.error"), err.message || "Failed to download export");
  }
};

// Load active privacy requests (mock for now)
const loadActiveRequests = async () => {
  // In a real implementation, you would fetch from the backend
  // For now, we'll use an empty array
  activeRequests.value = [];
};

// Format status text
const formatStatus = (status: string) => {
  return status.replace(/_/g, " ");
};

// Get status badge variant
const getStatusVariant = (status: string) => {
  switch (status) {
    case "completed":
      return "success";
    case "processing":
      return "default";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
};

// formatDate is provided by useOrgDateTime()

onMounted(() => {
  loadActiveRequests();
});
</script>
