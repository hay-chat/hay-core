<template>
  <div class="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
    <Card class="max-w-lg w-full">
      <CardHeader>
        <div class="flex justify-center mb-4">
          <div
            :class="{
              'bg-blue-100': !error && !downloaded,
              'bg-green-100': downloaded,
              'bg-red-100': error,
            }"
            class="w-16 h-16 rounded-full flex items-center justify-center"
          >
            <Loader2 v-if="loading" class="h-8 w-8 text-blue-600 animate-spin" />
            <CheckCircle v-else-if="downloaded" class="h-8 w-8 text-green-600" />
            <XCircle v-else-if="error" class="h-8 w-8 text-red-600" />
            <Download v-else class="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <CardTitle class="text-center">{{ title }}</CardTitle>
        <CardDescription class="text-center">{{ description }}</CardDescription>
      </CardHeader>

      <CardContent class="space-y-4">
        <!-- Loading State -->
        <div v-if="loading" class="text-center space-y-2">
          <p class="text-neutral-muted">Preparing your data export...</p>
          <div class="flex justify-center">
            <div class="w-48 h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div class="h-full bg-blue-600 animate-pulse"></div>
            </div>
          </div>
        </div>

        <!-- Ready to Download -->
        <div v-else-if="!downloaded && !error" class="space-y-4">
          <Alert>
            <AlertTitle>Your Export is Ready</AlertTitle>
            <AlertDescription>
              Click the button below to download your personal data export in JSON format.
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">What's included:</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>Profile information and account settings</li>
              <li>Organization memberships and roles</li>
              <li>API keys metadata (no secrets)</li>
              <li>Audit logs (last 1000 events)</li>
              <li>Documents and content</li>
            </ul>
          </div>

          <div class="flex justify-center pt-4">
            <Button :loading="downloading" @click="startDownload" size="lg">
              <Download class="h-4 w-4 mr-2" />
              Download My Data
            </Button>
          </div>

          <p class="text-xs text-neutral-muted text-center">
            File size: {{ fileSize }} • Format: JSON
          </p>
        </div>

        <!-- Downloaded State -->
        <div v-else-if="downloaded" class="space-y-4">
          <Alert :icon="CheckCircle">
            <AlertTitle>Download Complete</AlertTitle>
            <AlertDescription>
              Your data export has been downloaded successfully.
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">Next Steps:</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>Review your data in the downloaded JSON file</li>
              <li>Store the file securely as it contains personal information</li>
              <li>This download link will expire in 7 days</li>
            </ul>
          </div>

          <div class="flex justify-center space-x-2 pt-4">
            <Button variant="outline" @click="startDownload">
              <Download class="h-4 w-4 mr-2" />
              Download Again
            </Button>
            <Button @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
          </div>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="space-y-4">
          <Alert variant="destructive" :icon="AlertTriangle">
            <AlertTitle>Download Failed</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">Common issues:</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>The download link may have expired (valid for 7 days)</li>
              <li>The download token may be invalid</li>
              <li>The export may have been deleted</li>
            </ul>
          </div>

          <div class="flex justify-center space-x-2 pt-4">
            <Button variant="outline" @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
            <Button @click="requestNewExport">
              <RefreshCw class="h-4 w-4 mr-2" />
              Request New Export
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Hay } from "@/utils/api";
import {
  Download,
  CheckCircle,
  XCircle,
  Loader2,
  Info,
  AlertTriangle,
  Home,
  RefreshCw,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const downloading = ref(false);
const downloaded = ref(false);
const error = ref(false);
const errorMessage = ref("");
const fileSize = ref("~500 KB");
const exportData = ref<any>(null);

const requestId = computed(() => route.query.requestId as string);
const downloadToken = computed(() => route.query.token as string);

const title = computed(() => {
  if (loading.value) return "Preparing Download...";
  if (downloaded.value) return "Download Complete!";
  if (error.value) return "Download Failed";
  return "Data Export Ready";
});

const description = computed(() => {
  if (loading.value) return "Please wait while we prepare your data export";
  if (downloaded.value) return "Your personal data has been downloaded successfully";
  if (error.value) return "We couldn't download your data export";
  return "Your personal data export is ready to download";
});

const checkExportAvailability = async () => {
  if (!requestId.value || !downloadToken.value) {
    error.value = true;
    errorMessage.value = "Invalid download link. Missing request ID or token.";
    loading.value = false;
    return;
  }

  try {
    loading.value = true;

    // Check if export is ready
    const status = await Hay.privacy.getStatus.query({
      requestId: requestId.value,
    });

    if (status.status !== "completed") {
      error.value = true;
      errorMessage.value = `Export is not ready yet. Current status: ${status.status}`;
      loading.value = false;
      return;
    }

    if (!status.downloadAvailable) {
      error.value = true;
      errorMessage.value = "Export is no longer available for download.";
      loading.value = false;
      return;
    }

    loading.value = false;
  } catch (err: unknown) {
    const apiError = err as {
      data?: { code?: string };
      code?: string;
      message?: string;
      error?: { message?: string };
    };

    const errorCode = apiError.data?.code || apiError.code;
    const errMessage =
      apiError.message || apiError.error?.message || "Failed to check export availability";

    if (errorCode === "TOO_MANY_REQUESTS" || errMessage.toLowerCase().includes("rate limit")) {
      errorMessage.value = "Too many requests. Please wait a few minutes before trying again.";
    } else if (
      errorCode === "SERVICE_UNAVAILABLE" ||
      errMessage.toLowerCase().includes("unavailable")
    ) {
      errorMessage.value =
        "Privacy service is temporarily unavailable. Please try again in a few minutes.";
    } else {
      errorMessage.value = errMessage;
    }

    error.value = true;
    loading.value = false;
  }
};

const startDownload = async () => {
  if (!requestId.value || !downloadToken.value) {
    error.value = true;
    errorMessage.value = "Invalid download link.";
    return;
  }

  try {
    downloading.value = true;

    const result = await Hay.privacy.downloadExport.query({
      requestId: requestId.value,
      downloadToken: downloadToken.value,
    });

    exportData.value = result.data;

    // Create a blob and download
    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName || "data-export.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    downloaded.value = true;

    // Calculate file size
    const sizeInBytes = blob.size;
    if (sizeInBytes < 1024) {
      fileSize.value = `${sizeInBytes} B`;
    } else if (sizeInBytes < 1024 * 1024) {
      fileSize.value = `${(sizeInBytes / 1024).toFixed(2)} KB`;
    } else {
      fileSize.value = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  } catch (err: unknown) {
    const apiError = err as {
      data?: { code?: string };
      code?: string;
      message?: string;
      error?: { message?: string };
    };

    const errorCode = apiError.data?.code || apiError.code;
    const errMessage = apiError.message || apiError.error?.message || "Failed to download export";

    if (errorCode === "TOO_MANY_REQUESTS" || errMessage.toLowerCase().includes("rate limit")) {
      errorMessage.value =
        "Too many download attempts. This link may have exceeded its usage limit. Please request a new export.";
    } else if (
      errorCode === "SERVICE_UNAVAILABLE" ||
      errMessage.toLowerCase().includes("unavailable")
    ) {
      errorMessage.value =
        "Privacy service is temporarily unavailable. Please try again in a few minutes.";
    } else if (errMessage.toLowerCase().includes("expired")) {
      errorMessage.value =
        "This download link has expired. Please request a new data export from your settings.";
    } else if (
      errMessage.toLowerCase().includes("invalid") ||
      errMessage.toLowerCase().includes("token")
    ) {
      errorMessage.value =
        "Invalid or already used download link. Please request a new data export if needed.";
    } else {
      errorMessage.value = errMessage;
    }

    error.value = true;
  } finally {
    downloading.value = false;
  }
};

const goToDashboard = () => {
  router.push("/");
};

const requestNewExport = () => {
  router.push("/settings/privacy");
};

onMounted(() => {
  checkExportAvailability();
});
</script>
