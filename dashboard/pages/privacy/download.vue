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
          <p class="text-neutral-muted">{{ $t("privacyDownload.preparingExport") }}</p>
          <div class="flex justify-center">
            <div class="w-48 h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div class="h-full bg-blue-600 animate-pulse"></div>
            </div>
          </div>
        </div>

        <!-- Ready to Download -->
        <div v-else-if="!downloaded && !error" class="space-y-4">
          <Alert>
            <AlertTitle>{{ $t("privacyDownload.exportReady") }}</AlertTitle>
            <AlertDescription>
              {{ $t("privacyDownload.exportReadyDescription") }}
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">{{ $t("privacyDownload.whatsIncluded") }}</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>{{ $t("privacyDownload.includeProfile") }}</li>
              <li>{{ $t("privacyDownload.includeConversations") }}</li>
              <li>{{ $t("privacyDownload.includeEmbeddings") }}</li>
              <li>{{ $t("privacyDownload.includeSignature") }}</li>
              <li>{{ $t("privacyDownload.includeReadme") }}</li>
            </ul>
          </div>

          <div class="flex justify-center pt-4">
            <Button :loading="downloading" @click="startDownload" size="lg">
              <Download class="h-4 w-4 mr-2" />
              {{ $t("privacyDownload.downloadMyData") }}
            </Button>
          </div>

          <p class="text-xs text-neutral-muted text-center">
            {{ $t("privacyDownload.fileSize", { size: fileSize }) }} • {{ $t("privacyDownload.format", { format: exportFormat }) }}
          </p>
        </div>

        <!-- Downloaded State -->
        <div v-else-if="downloaded" class="space-y-4">
          <Alert :icon="CheckCircle">
            <AlertTitle>{{ $t("privacyDownload.downloadComplete") }}</AlertTitle>
            <AlertDescription>
              {{ $t("privacyDownload.downloadCompleteDescription") }}
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">{{ $t("privacyDownload.nextSteps") }}</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>{{ $t("privacyDownload.nextStep1") }}</li>
              <li>{{ $t("privacyDownload.nextStep2") }}</li>
              <li>{{ $t("privacyDownload.nextStep3") }}</li>
            </ul>
          </div>

          <div class="flex justify-center space-x-2 pt-4">
            <Button variant="outline" @click="startDownload">
              <Download class="h-4 w-4 mr-2" />
              {{ $t("privacyDownload.downloadAgain") }}
            </Button>
            <Button @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              {{ $t("common.goToDashboard") }}
            </Button>
          </div>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="space-y-4">
          <Alert variant="destructive" :icon="AlertTriangle">
            <AlertTitle>{{ $t("privacyDownload.downloadFailed") }}</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">{{ $t("privacyDownload.commonIssues") }}</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>{{ $t("privacyDownload.linkExpired") }}</li>
              <li>{{ $t("privacyDownload.tokenInvalid") }}</li>
              <li>{{ $t("privacyDownload.exportDeleted") }}</li>
            </ul>
          </div>

          <div class="flex justify-center space-x-2 pt-4">
            <Button variant="outline" @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              {{ $t("common.goToDashboard") }}
            </Button>
            <Button @click="requestNewExport">
              <RefreshCw class="h-4 w-4 mr-2" />
              {{ $t("privacyDownload.requestNewExport") }}
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
import { useI18n } from "vue-i18n";
import { Hay } from "@/utils/api";
import {
  Download,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Home,
  RefreshCw,
} from "lucide-vue-next";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const downloading = ref(false);
const downloaded = ref(false);
const error = ref(false);
const errorMessage = ref("");
const fileSize = ref("~500 KB");
const exportData = ref<any>(null);
const isZipFormat = ref(true);

const exportFormat = computed(() => (isZipFormat.value ? "ZIP Archive" : "JSON"));

const requestId = computed(() => route.query.requestId as string);
const downloadToken = computed(() => route.query.token as string);

const title = computed(() => {
  if (loading.value) return t("privacyDownload.loadingTitle");
  if (downloaded.value) return t("privacyDownload.downloadedTitle");
  if (error.value) return t("privacyDownload.errorTitle");
  return t("privacyDownload.readyTitle");
});

const description = computed(() => {
  if (loading.value) return t("privacyDownload.loadingDescription");
  if (downloaded.value) return t("privacyDownload.downloadedDescription");
  if (error.value) return t("privacyDownload.errorDescription");
  return t("privacyDownload.readyDescription");
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

    let blob: Blob;
    let fileName: string;

    // Handle ZIP format (new) vs JSON format (legacy)
    // Type guard: check if base64Data exists in result
    if ("base64Data" in result && result.base64Data) {
      // Decode base64 to binary
      const binaryString = atob(result.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: "application/zip" });
      fileName = result.fileName || "data-export.zip";
      isZipFormat.value = true;
    } else {
      // Legacy JSON format
      exportData.value = result.data;
      blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      fileName = result.fileName || "data-export.json";
      isZipFormat.value = false;
    }

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
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
