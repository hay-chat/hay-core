<template>
  <Page :title="$t('upload.title')" :description="$t('upload.description')">
    <template #header>
      <Button variant="outline" size="sm" @click="navigateToMarketplace">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ $t("upload.backToMarketplace") }}
      </Button>
    </template>

    <!-- Upload Card -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("upload.card.title") }}</CardTitle>
        <CardDescription>
          {{ $t("upload.card.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- File Upload -->
        <div class="space-y-2">
          <Label for="plugin-file">{{ $t("upload.file.label") }}</Label>
          <div
            class="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors"
            :class="{
              'border-primary bg-primary/5': isDragging,
              'border-green-500 bg-green-50': uploadSuccess,
            }"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
          >
            <input
              id="plugin-file"
              ref="fileInput"
              type="file"
              accept=".zip"
              class="hidden"
              @change="handleFileSelect"
            />

            <div v-if="!selectedFile && !uploadSuccess">
              <Upload class="h-12 w-12 mx-auto text-neutral-muted mb-4" />
              <p class="text-sm font-medium mb-2">{{ $t("upload.file.dropHint") }}</p>
              <p class="text-xs text-neutral-muted mb-4">{{ $t("upload.file.maxSize") }}</p>
              <Button variant="outline" @click="triggerFileInput">
                <Upload class="h-4 w-4 mr-2" />
                {{ $t("upload.file.selectFile") }}
              </Button>
            </div>

            <div v-else-if="selectedFile && !uploadSuccess">
              <FileArchive class="h-12 w-12 mx-auto text-primary mb-4" />
              <p class="text-sm font-medium mb-1">{{ selectedFile.name }}</p>
              <p class="text-xs text-neutral-muted mb-4">{{ formatFileSize(selectedFile.size) }}</p>
              <Button variant="outline" size="sm" @click="clearFile">
                <X class="h-4 w-4 mr-2" />
                {{ $t("upload.file.remove") }}
              </Button>
            </div>

            <div v-else-if="uploadSuccess">
              <CheckCircle class="h-12 w-12 mx-auto text-green-600 mb-4" />
              <p class="text-sm font-medium text-green-600 mb-2">
                {{ $t("upload.success.message") }}
              </p>
              <p class="text-xs text-neutral-muted mb-4">{{ uploadedPluginName }}</p>
              <div class="flex justify-center space-x-2">
                <Button variant="outline" size="sm" @click="resetUpload">
                  <Upload class="h-4 w-4 mr-2" />
                  {{ $t("upload.success.uploadAnother") }}
                </Button>
                <Button size="sm" @click="navigateToMarketplace">
                  <ArrowLeft class="h-4 w-4 mr-2" />
                  {{ $t("upload.success.viewMarketplace") }}
                </Button>
              </div>
            </div>
          </div>

          <!-- Upload Progress -->
          <div v-if="uploading" class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-neutral-muted">{{ $t("upload.progress.uploading") }}</span>
              <span class="font-medium">{{ uploadProgress }}%</span>
            </div>
            <div class="w-full bg-neutral-muted rounded-full h-2">
              <div
                class="bg-primary h-2 rounded-full transition-all duration-300"
                :style="{ width: `${uploadProgress}%` }"
              />
            </div>
          </div>

          <!-- Error Message -->
          <Alert v-if="uploadError" variant="destructive">
            <AlertTitle>{{ $t("upload.errors.title") }}</AlertTitle>
            <AlertDescription>{{ uploadError }}</AlertDescription>
          </Alert>
        </div>

        <!-- Upload Button -->
        <div class="flex justify-end">
          <Button :disabled="!selectedFile || uploading" :loading="uploading" @click="uploadPlugin">
            <Upload class="h-4 w-4 mr-2" />
            {{ uploading ? $t("upload.progress.uploading") : $t("upload.progress.uploadPlugin") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Requirements Card -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("upload.requirements.title") }}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4 text-sm">
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">{{ $t("upload.requirements.manifest.title") }}</p>
              <p class="text-neutral-muted">
                {{ $t("upload.requirements.manifest.description") }}
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">{{ $t("upload.requirements.pluginId.title") }}</p>
              <p class="text-neutral-muted">
                {{ $t("upload.requirements.pluginId.description") }}
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">{{ $t("upload.requirements.zipFormat.title") }}</p>
              <p class="text-neutral-muted">
                {{ $t("upload.requirements.zipFormat.description") }}
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">{{ $t("upload.requirements.noPathTraversal.title") }}</p>
              <p class="text-neutral-muted">
                {{ $t("upload.requirements.noPathTraversal.description") }}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { Upload, FileArchive, CheckCircle, X, ArrowLeft, AlertCircle } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();
const { toast } = useToast();
const { getApiUrl } = useDomain();

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const uploadProgress = ref(0);
const uploadError = ref<string | null>(null);
const uploadSuccess = ref(false);
const uploadedPluginName = ref<string | null>(null);
const isDragging = ref(false);

const triggerFileInput = () => {
  fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    validateAndSetFile(file);
  }
};

const handleDrop = (event: DragEvent) => {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    validateAndSetFile(file);
  }
};

const validateAndSetFile = (file: File) => {
  uploadError.value = null;

  // Validate file type
  if (!file.name.endsWith(".zip")) {
    uploadError.value = t("upload.errors.zipOnly");
    return;
  }

  // Validate file size (50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    uploadError.value = t("upload.errors.tooLarge");
    return;
  }

  selectedFile.value = file;
};

const clearFile = () => {
  selectedFile.value = null;
  uploadError.value = null;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
};

const resetUpload = () => {
  clearFile();
  uploadSuccess.value = false;
  uploadedPluginName.value = null;
  uploadProgress.value = 0;
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const uploadPlugin = async () => {
  if (!selectedFile.value) return;

  uploading.value = true;
  uploadError.value = null;
  uploadProgress.value = 0;

  try {
    const formData = new FormData();
    formData.append("plugin", selectedFile.value);

    // Simulate progress (since we don't have real progress from fetch)
    const progressInterval = setInterval(() => {
      if (uploadProgress.value < 90) {
        uploadProgress.value += 10;
      }
    }, 200);

    const response = await fetch(getApiUrl("/v1/plugins/upload"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.tokens?.accessToken}`,
        "x-organization-id": userStore.activeOrganizationId!,
      },
      body: formData,
    });

    clearInterval(progressInterval);
    uploadProgress.value = 100;

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || t("upload.errors.uploadFailed"));
    }

    const result = await response.json();
    uploadSuccess.value = true;
    uploadedPluginName.value = result.name;

    toast.success(t("upload.toast.uploadedSuccess", { name: result.name }));

    // Refresh plugins in store after a short delay
    setTimeout(async () => {
      const { useAppStore } = await import("@/stores/app");
      const appStore = useAppStore();
      await appStore.fetchPlugins();
    }, 1000);
  } catch (error: any) {
    console.error("Upload failed:", error);
    const errorMessage = error.message || t("upload.errors.uploadFailed");
    uploadError.value = errorMessage;
    toast.error(errorMessage);
  } finally {
    uploading.value = false;
  }
};

const navigateToMarketplace = () => {
  router.push("/integrations/marketplace");
};

definePageMeta({
  layout: "default",
});

useHead({
  title: t("upload.headTitle"),
  meta: [
    {
      name: "description",
      content: t("upload.description"),
    },
  ],
});
</script>
