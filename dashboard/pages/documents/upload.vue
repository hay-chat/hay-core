<template>
  <div class="max-w-4xl mx-auto space-y-8">
    <!-- Page Header -->
    <div>
      <div class="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <NuxtLink to="/documents" class="hover:text-foreground"
          >Documents</NuxtLink
        >
        <ChevronRight class="h-4 w-4" />
        <span>Upload</span>
      </div>
      <h1 class="text-3xl font-bold text-foreground">Upload Document</h1>
      <p class="mt-2 text-muted-foreground">
        Add new documents to your knowledge base for AI agents to reference.
      </p>
    </div>

    <!-- Upload Steps -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-2">
        <div
          :class="[
            'flex items-center justify-center w-8 h-8 rounded-full',
            currentStep >= 1
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          ]"
        >
          1
        </div>
        <span
          :class="
            currentStep >= 1 ? 'text-foreground' : 'text-muted-foreground'
          "
          >Select Files</span
        >
      </div>
      <div class="flex-1 mx-4 h-px bg-border"></div>
      <div class="flex items-center gap-2">
        <div
          :class="[
            'flex items-center justify-center w-8 h-8 rounded-full',
            currentStep >= 2
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          ]"
        >
          2
        </div>
        <span
          :class="
            currentStep >= 2 ? 'text-foreground' : 'text-muted-foreground'
          "
          >Add Details</span
        >
      </div>
      <div class="flex-1 mx-4 h-px bg-border"></div>
      <div class="flex items-center gap-2">
        <div
          :class="[
            'flex items-center justify-center w-8 h-8 rounded-full',
            currentStep >= 3
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          ]"
        >
          3
        </div>
        <span
          :class="
            currentStep >= 3 ? 'text-foreground' : 'text-muted-foreground'
          "
          >Upload</span
        >
      </div>
    </div>

    <!-- Step 1: File Selection -->
    <Card v-if="currentStep === 1">
      <CardHeader>
        <CardTitle>Select Files</CardTitle>
        <CardDescription>
          Choose one or more documents to upload. Supported formats: PDF, TXT,
          MD, DOC, DOCX, HTML, JSON, CSV
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          class="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
          :class="{ 'border-primary bg-primary/5': isDragging }"
          @click="selectFiles"
          @drop="handleDrop"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @dragenter.prevent
        >
          <Upload class="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <h3 class="text-lg font-semibold mb-2">
            {{
              isDragging
                ? "Drop files here"
                : "Click to upload or drag and drop"
            }}
          </h3>
          <p class="text-sm text-muted-foreground mb-4">
            Support for multiple files up to 10MB each
          </p>
          <Button variant="outline">
            <Upload class="mr-2 h-4 w-4" />
            Browse Files
          </Button>
        </div>

        <!-- Selected Files List -->
        <div v-if="selectedFiles.length > 0" class="mt-6 space-y-2">
          <h4 class="font-medium mb-2">
            Selected Files ({{ selectedFiles.length }})
          </h4>
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="flex items-center gap-3 p-3 bg-muted rounded-lg"
          >
            <component
              :is="getFileIcon(file.type)"
              class="h-5 w-5 text-muted-foreground flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ file.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ formatFileSize(file.size) }}
              </p>
            </div>
            <Badge variant="outline">{{ getFileExtension(file.name) }}</Badge>
            <Button variant="ghost" size="sm" @click="removeFile(index)">
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button
            variant="outline"
            @click="selectedFiles = []"
            :disabled="selectedFiles.length === 0"
          >
            Clear All
          </Button>
          <Button
            @click="currentStep = 2"
            :disabled="selectedFiles.length === 0"
          >
            Next: Add Details
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2: Document Details -->
    <Card v-if="currentStep === 2">
      <CardHeader>
        <CardTitle>Document Details</CardTitle>
        <CardDescription>
          Provide metadata for your documents to help with organization and
          searchability.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-6">
          <!-- Document Details Form -->
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="p-4 border rounded-lg space-y-4"
          >
            <div class="flex items-center gap-3 mb-4">
              <component
                :is="getFileIcon(file.type)"
                class="h-5 w-5 text-muted-foreground"
              />
              <span class="font-medium">{{ file.name }}</span>
              <Badge variant="outline">{{ getFileExtension(file.name) }}</Badge>
            </div>

            <div class="grid gap-4">
              <div>
                <Label :for="`name-${index}`">Document Name</Label>
                <Input
                  :id="`name-${index}`"
                  v-model="file.documentName"
                  placeholder="Enter a descriptive name"
                />
              </div>

              <div>
                <Label :for="`category-${index}`">Category</Label>
                <select
                  :id="`category-${index}`"
                  v-model="file.category"
                  class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a category</option>
                  <option value="product">Product Documentation</option>
                  <option value="api">API Reference</option>
                  <option value="faq">FAQs</option>
                  <option value="legal">Legal Documents</option>
                  <option value="training">Training Materials</option>
                  <option value="technical">Technical Specs</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <Label :for="`description-${index}`">Description</Label>
                <Textarea
                  :id="`description-${index}`"
                  :modelValue="file.description || ''"
                  @update:modelValue="file.description = $event"
                  placeholder="Brief description of the document's contents"
                  :rows="2"
                />
              </div>

              <div>
                <Label :for="`tags-${index}`">Tags</Label>
                <Input
                  :id="`tags-${index}`"
                  v-model="file.tags"
                  placeholder="Enter tags separated by commas"
                />
                <p class="text-xs text-muted-foreground mt-1">
                  e.g., customer-support, billing, api
                </p>
              </div>

              <div class="flex items-center space-x-2">
                <Checkbox :id="`active-${index}`" v-model="file.isActive" />
                <Label :for="`active-${index}`" class="text-sm font-normal">
                  Make this document immediately available to AI agents
                </Label>
              </div>
            </div>
          </div>

          <!-- Global Settings -->
          <div class="border-t pt-6">
            <h4 class="font-medium mb-4">Apply to All Documents</h4>
            <div class="grid gap-4">
              <div>
                <Label for="global-category">Category</Label>
                <select
                  id="global-category"
                  v-model="globalSettings.category"
                  @change="applyGlobalCategory"
                  class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select to apply to all</option>
                  <option value="product">Product Documentation</option>
                  <option value="api">API Reference</option>
                  <option value="faq">FAQs</option>
                  <option value="legal">Legal Documents</option>
                  <option value="training">Training Materials</option>
                  <option value="technical">Technical Specs</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div class="flex items-center space-x-2">
                <Checkbox
                  id="global-active"
                  v-model="globalSettings.isActive"
                  @update:checked="applyGlobalActive"
                />
                <Label for="global-active" class="text-sm font-normal">
                  Make all documents immediately available to AI agents
                </Label>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 1">
            <ChevronLeft class="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button @click="startUpload">
            <Upload class="mr-2 h-4 w-4" />
            Start Upload
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3: Upload Progress -->
    <Card v-if="currentStep === 3">
      <CardHeader>
        <CardTitle>Uploading Documents</CardTitle>
        <CardDescription>
          Your documents are being processed and added to the knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <!-- Overall Progress -->
          <div class="mb-6">
            <div class="flex justify-between text-sm mb-2">
              <span>Overall Progress</span>
              <span>{{ uploadedCount }}/{{ selectedFiles.length }} files</span>
            </div>
            <Progress :value="overallProgress" class="h-2" />
          </div>

          <!-- Individual File Progress -->
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="p-4 border rounded-lg"
          >
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <component
                  :is="getFileIcon(file.type)"
                  class="h-4 w-4 text-muted-foreground"
                />
                <span class="text-sm font-medium">{{
                  file.documentName || file.name
                }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Badge
                  v-if="file.uploadStatus === 'completed'"
                  variant="default"
                  class="bg-green-600"
                >
                  <CheckCircle class="mr-1 h-3 w-3" />
                  Completed
                </Badge>
                <Badge
                  v-else-if="file.uploadStatus === 'uploading'"
                  variant="secondary"
                >
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  Uploading
                </Badge>
                <Badge
                  v-else-if="file.uploadStatus === 'processing'"
                  variant="secondary"
                >
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  Processing
                </Badge>
                <Badge
                  v-else-if="file.uploadStatus === 'error'"
                  variant="destructive"
                >
                  <AlertCircle class="mr-1 h-3 w-3" />
                  Error
                </Badge>
                <Badge v-else variant="outline"> Pending </Badge>
              </div>
            </div>

            <Progress :value="file.progress || 0" class="h-1" />

            <div
              v-if="file.uploadStatus === 'error'"
              class="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive"
            >
              {{ file.errorMessage || "Upload failed. Please try again." }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button
            variant="outline"
            @click="resetUpload"
            :disabled="isUploading"
          >
            Upload More Documents
          </Button>
          <Button @click="router.push('/documents')" :disabled="isUploading">
            <CheckCircle class="mr-2 h-4 w-4" />
            View Documents
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  X,
  FileText,
  FileCode,
  FileJson,
  File,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-vue-next";

const router = useRouter();

definePageMeta({
  // middleware: 'auth'
});

const { $api } = useNuxtApp();

interface UploadFile extends File {
  documentName?: string;
  category?: string;
  description?: string;
  tags?: string;
  isActive?: boolean;
  progress?: number;
  uploadStatus?: "pending" | "uploading" | "processing" | "completed" | "error";
  errorMessage?: string;
}

// State
const currentStep = ref(1);
const selectedFiles = ref<UploadFile[]>([]);
const isDragging = ref(false);
const isUploading = ref(false);
const uploadedCount = ref(0);

const globalSettings = ref({
  category: "",
  isActive: true,
});

// Computed
const overallProgress = computed(() => {
  if (selectedFiles.value.length === 0) return 0;
  const totalProgress = selectedFiles.value.reduce(
    (sum, file) => sum + (file.progress || 0),
    0
  );
  return Math.round(totalProgress / selectedFiles.value.length);
});

// Methods
const getFileIcon = (type: string) => {
  const mimeType = type.toLowerCase();
  if (mimeType.includes("pdf") || mimeType.includes("doc")) return FileText;
  if (mimeType.includes("json")) return FileJson;
  if (mimeType.includes("text") || mimeType.includes("markdown"))
    return FileCode;
  return File;
};

const getFileExtension = (filename: string) => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()?.toUpperCase() : "FILE";
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const selectFiles = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".pdf,.txt,.md,.doc,.docx,.html,.json,.csv";
  input.onchange = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      addFiles(Array.from(target.files));
    }
  };
  input.click();
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;

  if (e.dataTransfer?.files) {
    addFiles(Array.from(e.dataTransfer.files));
  }
};

const addFiles = (files: File[]) => {
  const validFiles = files.filter((file) => {
    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      console.error(`File ${file.name} exceeds 10MB limit`);
      return false;
    }

    // Check file type
    const validTypes = [
      "pdf",
      "txt",
      "md",
      "doc",
      "docx",
      "html",
      "json",
      "csv",
    ];
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !validTypes.includes(extension)) {
      console.error(`File ${file.name} has unsupported format`);
      return false;
    }

    return true;
  });

  // Add files with default metadata
  validFiles.forEach((file) => {
    const uploadFile = file as UploadFile;
    uploadFile.documentName = file.name.replace(/\.[^/.]+$/, "");
    uploadFile.category = "";
    uploadFile.description = "";
    uploadFile.tags = "";
    uploadFile.isActive = true;
    uploadFile.progress = 0;
    uploadFile.uploadStatus = "pending";

    selectedFiles.value.push(uploadFile);
  });
};

const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1);
};

const applyGlobalCategory = () => {
  if (globalSettings.value.category) {
    selectedFiles.value.forEach((file) => {
      file.category = globalSettings.value.category;
    });
  }
};

const applyGlobalActive = (checked: boolean) => {
  selectedFiles.value.forEach((file) => {
    file.isActive = checked;
  });
};

const startUpload = async () => {
  currentStep.value = 3;
  isUploading.value = true;
  uploadedCount.value = 0;

  try {
    // Prepare form data for upload
    const formData = new FormData();

    // Add files to form data
    for (const file of selectedFiles.value) {
      formData.append("documents", file as File);
    }

    // Add metadata for all files
    formData.append("category", globalSettings.value.category || "");
    formData.append("isActive", String(globalSettings.value.isActive));

    // Add individual file metadata if needed
    const fileMetadata = selectedFiles.value.map((file) => ({
      documentName: file.documentName,
      category: file.category,
      description: file.description,
      tags: file.tags,
      isActive: file.isActive,
    }));
    formData.append("fileMetadata", JSON.stringify(fileMetadata));

    // Add processing options
    formData.append("includeMetadata", "true");
    formData.append("extractTables", "true");
    formData.append("chunkingStrategy", "semantic");
    formData.append("chunkSize", "1500");

    // Track individual file progress
    for (const file of selectedFiles.value) {
      file.uploadStatus = "uploading";
      file.progress = 0;
    }

    // // Upload files to backend
    // const response = await $api("/api/v1/documents/upload", {
    //   method: "POST",
    //   body: formData,
    //   onUploadProgress: (progress: { loaded: number; total: number }) => {
    //     // Update upload progress for all files
    //     const percentage = Math.round((progress.loaded / progress.total) * 50); // 50% for upload
    //     for (const file of selectedFiles.value) {
    //       if (file.uploadStatus === "uploading") {
    //         file.progress = percentage;
    //       }
    //     }
    //   },
    // });

    // // Process response
    // if (response.success && response.results) {
    //   for (let i = 0; i < response.results.length; i++) {
    //     const result = response.results[i];
    //     const file = selectedFiles.value[i];
    //     if (!file) continue;

    //     if (result.status === "queued") {
    //       file.uploadStatus = "processing";
    //       file.progress = 50;

    //       // Poll for processing status
    //       await pollProcessingStatus(result.documentId, file);
    //     } else if (result.status === "error") {
    //       file.uploadStatus = "error";
    //       file.errorMessage = result.error || "Upload failed";
    //     }
    //   }
    // }

    uploadedCount.value = selectedFiles.value.filter(
      (f) => f.uploadStatus === "completed"
    ).length;
  } catch (error) {
    console.error("Upload error:", error);

    // Mark all files as error
    for (const file of selectedFiles.value) {
      if (file.uploadStatus !== "completed") {
        file.uploadStatus = "error";
        file.errorMessage =
          error instanceof Error ? error.message : "Upload failed";
      }
    }
  } finally {
    isUploading.value = false;
  }
};

// Poll for document processing status
const pollProcessingStatus = async (documentId: string, file: UploadFile) => {
  const maxAttempts = 30; // 30 seconds timeout
  let attempts = 0;

  while (attempts < maxAttempts && file.uploadStatus === "processing") {
    try {
      // const status = await $api(
      //   `/api/v1/documents/upload/status/${documentId}`
      // );
      // if (status.success && status.status) {
      //   if (status.status.status === "completed") {
      //     file.uploadStatus = "completed";
      //     file.progress = 100;
      //     break;
      //   } else if (status.status.status === "error") {
      //     file.uploadStatus = "error";
      //     file.errorMessage = status.status.error || "Processing failed";
      //     break;
      //   } else {
      //     // Still processing, update progress
      //     file.progress = Math.min(95, 50 + attempts * 1.5);
      //   }
      // }
    } catch (error) {
      console.error("Status polling error:", error);
    }

    // Wait 1 second before next poll
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  // Timeout - mark as completed anyway
  if (file.uploadStatus === "processing") {
    file.uploadStatus = "completed";
    file.progress = 100;
  }
};

const resetUpload = () => {
  currentStep.value = 1;
  selectedFiles.value = [];
  uploadedCount.value = 0;
  globalSettings.value = {
    category: "",
    isActive: true,
  };
};

// SEO
useHead({
  title: "Upload Documents - Hay Dashboard",
  meta: [
    { name: "description", content: "Upload documents to your knowledge base" },
  ],
});
</script>
