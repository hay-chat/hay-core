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
            <Progress
              :value="(uploadedCount / selectedFiles.length) * 100"
              class="h-2"
            />
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

            <Progress
              :value="
                file.uploadStatus === 'completed'
                  ? 100
                  : file.uploadStatus === 'processing'
                  ? 50
                  : file.uploadStatus === 'uploading'
                  ? 25
                  : 0
              "
              class="h-1"
            />

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
import { HayApi } from "@/utils/api";

const router = useRouter();

interface UploadFile extends File {
  documentName?: string;
  category?: string;
  description?: string;
  tags?: string;
  isActive?: boolean;
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

// Computed properties removed - using uploadedCount directly in template

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

  // Get organization/organization ID from auth or use default
  // In production, this should come from your authenticated user's context
  const authToken = useCookie("auth-token");
  const organizationId = authToken.value ? "org_default" : "default"; // TODO: Parse from JWT or fetch from API

  try {
    // Upload files sequentially
    for (let i = 0; i < selectedFiles.value.length; i++) {
      const file = selectedFiles.value[i];
      file.uploadStatus = "uploading";

      try {
        // Read file content as base64
        const fileBuffer = await fileToBase64(file as File);

        // Prepare the document data
        const documentData = {
          title: file.documentName || file.name,
          content: file.description || `Document: ${file.name}`,
          fileBuffer: fileBuffer,
          mimeType: file.type,
          fileName: file.name,
          organizationId: organizationId,
          // Use enums from the server (lowercase values)
          type: mapCategoryToDocumentType(
            file.category || globalSettings.value.category
          ) as any,
          status: (file.isActive ? "published" : "draft") as any,
          visibility: "private" as any,
        };

        file.uploadStatus = "processing";

        // Upload using tRPC
        const response = await HayApi.documents.create.mutate(documentData);

        if (response && response.id) {
          file.uploadStatus = "completed";
          uploadedCount.value++;
        } else {
          throw new Error("Invalid response from server");
        }
      } catch (fileError) {
        console.error(`Upload error for ${file.name}:`, fileError);
        file.uploadStatus = "error";
        file.errorMessage =
          fileError instanceof Error ? fileError.message : "Upload failed";
      }
    }

    // Check if all files uploaded successfully
    const allSuccess = selectedFiles.value.every(
      (f) => f.uploadStatus === "completed"
    );

    if (allSuccess) {
      // Show success notification
      showNotification(
        "Documents Uploaded",
        `Successfully uploaded ${uploadedCount.value} document(s)`,
        "success"
      );
    } else {
      const failedCount = selectedFiles.value.filter(
        (f) => f.uploadStatus === "error"
      ).length;

      if (failedCount > 0) {
        showNotification(
          "Some uploads failed",
          `${uploadedCount.value} succeeded, ${failedCount} failed`,
          "warning"
        );
      }
    }
  } catch (error) {
    console.error("Upload error:", error);

    showNotification(
      "Upload Failed",
      error instanceof Error ? error.message : "Failed to upload documents",
      "error"
    );

    // Mark all pending files as error
    for (const file of selectedFiles.value) {
      if (
        file.uploadStatus === "uploading" ||
        file.uploadStatus === "pending"
      ) {
        file.uploadStatus = "error";
        file.errorMessage =
          error instanceof Error ? error.message : "Upload failed";
      }
    }
  } finally {
    isUploading.value = false;
  }
};

// Helper function to convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove the data:*/*;base64, prefix
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Map UI category to server DocumentationType enum
const mapCategoryToDocumentType = (
  category: string
): "article" | "guide" | "faq" | "tutorial" | "reference" | "policy" => {
  const mapping: Record<
    string,
    "article" | "guide" | "faq" | "tutorial" | "reference" | "policy"
  > = {
    product: "guide",
    api: "reference",
    faq: "faq",
    legal: "policy",
    training: "tutorial",
    technical: "reference",
    other: "article",
  };
  return mapping[category] || "article";
};

// Since the tRPC mutation is synchronous, we don't need polling anymore
// The document is processed immediately on the server side

// Simple notification helper (you can replace with a proper toast library)
const showNotification = (
  title: string,
  message: string,
  type: "success" | "error" | "warning"
) => {
  // For now, just log to console. You can integrate with your preferred notification library
  console.log(`[${type.toUpperCase()}] ${title}: ${message}`);

  // You could also use the browser's native notification API or a Vue notification library
  if (type === "error") {
    console.error(message);
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
