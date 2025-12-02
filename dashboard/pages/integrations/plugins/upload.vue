<template>
  <Page title="Upload Custom Plugin" description="Upload a custom plugin to extend your platform">
    <template #header>
      <Button variant="outline" size="sm" @click="navigateToMarketplace">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back to Marketplace
      </Button>
    </template>

    <!-- Upload Card -->
    <Card>
      <CardHeader>
        <CardTitle>Upload Plugin ZIP</CardTitle>
        <CardDescription>
          Upload a ZIP file containing your custom plugin. The ZIP must include a
          <code>manifest.json</code> file in the root.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        <!-- File Upload -->
        <div class="space-y-2">
          <Label for="plugin-file">Plugin File</Label>
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
              <p class="text-sm font-medium mb-2">Drop your plugin ZIP here or click to browse</p>
              <p class="text-xs text-neutral-muted mb-4">Maximum file size: 50MB</p>
              <Button variant="outline" @click="triggerFileInput">
                <Upload class="h-4 w-4 mr-2" />
                Select File
              </Button>
            </div>

            <div v-else-if="selectedFile && !uploadSuccess">
              <FileArchive class="h-12 w-12 mx-auto text-primary mb-4" />
              <p class="text-sm font-medium mb-1">{{ selectedFile.name }}</p>
              <p class="text-xs text-neutral-muted mb-4">{{ formatFileSize(selectedFile.size) }}</p>
              <Button variant="outline" size="sm" @click="clearFile">
                <X class="h-4 w-4 mr-2" />
                Remove
              </Button>
            </div>

            <div v-else-if="uploadSuccess">
              <CheckCircle class="h-12 w-12 mx-auto text-green-600 mb-4" />
              <p class="text-sm font-medium text-green-600 mb-2">Plugin uploaded successfully!</p>
              <p class="text-xs text-neutral-muted mb-4">{{ uploadedPluginName }}</p>
              <div class="flex justify-center space-x-2">
                <Button variant="outline" size="sm" @click="resetUpload">
                  <Upload class="h-4 w-4 mr-2" />
                  Upload Another
                </Button>
                <Button size="sm" @click="navigateToMarketplace">
                  <ArrowLeft class="h-4 w-4 mr-2" />
                  View Marketplace
                </Button>
              </div>
            </div>
          </div>

          <!-- Upload Progress -->
          <div v-if="uploading" class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-neutral-muted">Uploading...</span>
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
            <AlertTitle>Upload Failed</AlertTitle>
            <AlertDescription>{{ uploadError }}</AlertDescription>
          </Alert>
        </div>

        <!-- Upload Button -->
        <div class="flex justify-end">
          <Button :disabled="!selectedFile || uploading" :loading="uploading" @click="uploadPlugin">
            <Upload class="h-4 w-4 mr-2" />
            {{ uploading ? "Uploading..." : "Upload Plugin" }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Requirements Card -->
    <Card>
      <CardHeader>
        <CardTitle>Plugin Requirements</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-4 text-sm">
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">Valid manifest.json</p>
              <p class="text-neutral-muted">
                Must include a manifest.json file in the root with id, name, and version fields
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">Valid plugin ID</p>
              <p class="text-neutral-muted">
                Plugin ID must contain only lowercase letters, numbers, and hyphens
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">ZIP format</p>
              <p class="text-neutral-muted">
                File must be in ZIP format with a maximum size of 50MB
              </p>
            </div>
          </div>
          <div class="flex items-start space-x-3">
            <CheckCircle class="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <p class="font-medium">No path traversal</p>
              <p class="text-neutral-muted">ZIP must not contain files with absolute paths or ..</p>
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
    uploadError.value = "Only ZIP files are allowed";
    return;
  }

  // Validate file size (50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    uploadError.value = "File size exceeds 50MB limit";
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
      throw new Error(error.error || "Upload failed");
    }

    const result = await response.json();
    uploadSuccess.value = true;
    uploadedPluginName.value = result.name;

    toast.success(`Plugin ${result.name} uploaded successfully!`);

    // Refresh plugins in store after a short delay
    setTimeout(async () => {
      const { useAppStore } = await import("@/stores/app");
      const appStore = useAppStore();
      await appStore.fetchPlugins();
    }, 1000);
  } catch (error: any) {
    console.error("Upload failed:", error);
    const errorMessage = error.message || "Failed to upload plugin";
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
  title: "Upload Plugin - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Upload a custom plugin to extend your platform",
    },
  ],
});
</script>
