<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Documents</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Manage your knowledge base documents for AI agents.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw
            class="mr-2 h-4 w-4"
            :class="{ 'animate-spin': loading }"
          />
          Refresh
        </Button>
        <NuxtLink to="/documents/upload">
          <Button>
            <Upload class="mr-2 h-4 w-4" />
            Upload Document
          </Button>
        </NuxtLink>
      </div>
    </div>

    <!-- Search and Filter -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search documents..."
            class="pl-10"
            @input="handleSearch"
          />
        </div>
      </div>
      <div class="flex gap-2">
        <select
          v-model="typeFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">All Types</option>
          <option value="pdf">PDF</option>
          <option value="txt">Text</option>
          <option value="md">Markdown</option>
          <option value="doc">Word</option>
          <option value="html">HTML</option>
        </select>
        <select
          v-model="statusFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="processing">Processing</option>
          <option value="archived">Archived</option>
          <option value="error">Error</option>
        </select>
      </div>
    </div>

    <!-- Bulk Actions -->
    <div v-if="selectedDocuments.length > 0" class="bg-muted p-4 rounded-lg">
      <div class="flex items-center justify-between">
        <p class="text-sm text-foreground">
          {{ selectedDocuments.length }} document{{
            selectedDocuments.length === 1 ? "" : "s"
          }}
          selected
        </p>
        <div class="flex space-x-2">
          <Button variant="outline" size="sm" @click="bulkArchive">
            <Archive class="mr-2 h-4 w-4" />
            Archive
          </Button>
          <Button variant="outline" size="sm" @click="bulkDownload">
            <Download class="mr-2 h-4 w-4" />
            Download
          </Button>
          <Button variant="destructive" size="sm" @click="bulkDelete">
            <Trash2 class="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>

    <!-- Documents Table -->
    <div
      v-if="!loading && filteredDocuments.length > 0"
      class="bg-background rounded-lg border"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-12">
              <Checkbox
                :checked="allSelected"
                @update:checked="toggleAllSelection"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Modified</TableHead>
            <TableHead>Uploaded By</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="document in filteredDocuments"
            :key="document.id"
            :class="
              selectedDocuments.includes(document.id) ? 'bg-muted/50' : ''
            "
          >
            <TableCell>
              <Checkbox
                :checked="selectedDocuments.includes(document.id)"
                @update:checked="toggleDocumentSelection(document.id)"
              />
            </TableCell>
            <TableCell class="font-medium">
              <div class="flex items-center gap-2">
                <component
                  :is="getFileIcon(document.type)"
                  class="h-4 w-4 text-muted-foreground"
                />
                {{ document.name }}
              </div>
            </TableCell>
            <TableCell>
              <span
                class="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs"
              >
                {{ document.type.toUpperCase() }}
              </span>
            </TableCell>
            <TableCell>{{ formatFileSize(document.size) }}</TableCell>
            <TableCell>
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  document.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : document.status === 'processing'
                    ? 'bg-blue-100 text-blue-800'
                    : document.status === 'archived'
                    ? 'bg-gray-100 text-gray-800'
                    : 'bg-red-100 text-red-800',
                ]"
              >
                <div
                  :class="[
                    'w-2 h-2 rounded-full mr-2',
                    document.status === 'active'
                      ? 'bg-green-600'
                      : document.status === 'processing'
                      ? 'bg-blue-600 animate-pulse'
                      : document.status === 'archived'
                      ? 'bg-gray-600'
                      : 'bg-red-600',
                  ]"
                ></div>
                {{ document.status }}
              </div>
            </TableCell>
            <TableCell>{{ formatDate(document.updatedAt) }}</TableCell>
            <TableCell>{{ document.uploadedBy }}</TableCell>
            <TableCell class="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                    <MoreVertical class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="viewDocument(document)">
                    <Eye class="mr-2 h-4 w-4" />
                    View
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="downloadDocument(document)">
                    <Download class="mr-2 h-4 w-4" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="editDocument(document)">
                    <Edit class="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="archiveDocument(document)">
                    <Archive class="mr-2 h-4 w-4" />
                    {{
                      document.status === "archived" ? "Unarchive" : "Archive"
                    }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="text-destructive"
                    @click="deleteDocument(document)"
                  >
                    <Trash2 class="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!loading && filteredDocuments.length === 0"
      class="text-center py-12"
    >
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">
        {{
          searchQuery || typeFilter || statusFilter
            ? "No documents found"
            : "No documents yet"
        }}
      </h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {{
          searchQuery || typeFilter || statusFilter
            ? "Try adjusting your search or filters."
            : "Get started by uploading your first document."
        }}
      </p>
      <div class="mt-6">
        <Button
          v-if="searchQuery || typeFilter || statusFilter"
          @click="clearFilters()"
        >
          Clear Filters
        </Button>
        <NuxtLink v-else to="/documents/upload">
          <Button>Upload Document</Button>
        </NuxtLink>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div class="bg-muted rounded-lg p-4 flex items-center space-x-4">
          <div class="h-10 w-10 bg-muted-foreground/20 rounded"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-muted-foreground/20 rounded w-1/4"></div>
            <div class="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";

import {
  FileText,
  Upload,
  RefreshCw,
  Search,
  Download,
  Trash2,
  Archive,
  MoreVertical,
  Eye,
  Edit,
  X,
  FileCode,
  FileJson,
  File,
} from "lucide-vue-next";

definePageMeta({
  // middleware: 'auth'
});

// State
const loading = ref(false);
const searchQuery = ref("");
const typeFilter = ref("");
const statusFilter = ref("");
const selectedDocuments = ref<string[]>([]);
const documents = ref<any[]>([]);
const currentPage = ref(1);
const totalPages = ref(1);
const totalDocuments = ref(0);

// Computed
const filteredDocuments = computed(() => {
  let filtered = documents.value;

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (doc) =>
        doc.name.toLowerCase().includes(query) ||
        doc.description?.toLowerCase().includes(query)
    );
  }

  if (typeFilter.value) {
    filtered = filtered.filter((doc) => doc.type === typeFilter.value);
  }

  if (statusFilter.value) {
    filtered = filtered.filter((doc) => doc.status === statusFilter.value);
  }

  return filtered;
});

const allSelected = computed(() => {
  return (
    filteredDocuments.value.length > 0 &&
    filteredDocuments.value.every((doc) =>
      selectedDocuments.value.includes(doc.id)
    )
  );
});

// Methods
const getFileIcon = (type: string) => {
  switch (type) {
    case "pdf":
    case "doc":
      return FileText;
    case "md":
    case "txt":
      return FileCode;
    case "json":
      return FileJson;
    default:
      return File;
  }
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const refreshData = async () => {
  // loading.value = true;
  // try {
  //   // Fetch documents from API
  //   const params = new URLSearchParams({
  //     page: currentPage.value.toString(),
  //     limit: "20",
  //     ...(searchQuery.value && { search: searchQuery.value }),
  //     ...(statusFilter.value && { status: statusFilter.value }),
  //     ...(typeFilter.value && { type: typeFilter.value }),
  //   });
  //   // const response = await $api(`/api/v1/documents?${params.toString()}`);
  //   if (response.data) {
  //     // Map API response to our format
  //     documents.value = response.data.map((doc: any) => ({
  //       id: doc.id,
  //       name: doc.title,
  //       type: detectFileType(
  //         doc.metadata?.mimeType || "",
  //         doc.metadata?.extension || ""
  //       ),
  //       size: doc.metadata?.fileSize || 0,
  //       status: mapDocumentStatus(doc.status, doc.metadata?.processingStatus),
  //       updatedAt: new Date(doc.updatedAt),
  //       uploadedBy: doc.createdBy || "Unknown",
  //       description: doc.summary || doc.content?.substring(0, 100) || "",
  //       metadata: doc.metadata,
  //     }));
  //     totalDocuments.value = response.total || documents.value.length;
  //     totalPages.value =
  //       response.totalPages || Math.ceil(totalDocuments.value / 20);
  //   }
  //   console.log("Documents refreshed successfully");
  // } catch (error) {
  //   console.error("Error refreshing data:", error);
  //   // If API fails, show some sample data for demo purposes
  //   documents.value = [
  //     {
  //       id: "demo-1",
  //       name: "Sample Document",
  //       type: "pdf",
  //       size: 1024000,
  //       status: "active",
  //       updatedAt: new Date(),
  //       uploadedBy: "Demo User",
  //       description:
  //         "This is a sample document. Upload real documents to see them here.",
  //     },
  //   ];
  // } finally {
  //   loading.value = false;
  // }
};

// Helper function to detect file type from MIME type or extension
const detectFileType = (mimeType: string, extension: string): string => {
  if (mimeType.includes("pdf") || extension === "pdf") return "pdf";
  if (mimeType.includes("word") || extension === "docx" || extension === "doc")
    return "doc";
  if (mimeType.includes("text/plain") || extension === "txt") return "txt";
  if (mimeType.includes("markdown") || extension === "md") return "md";
  if (mimeType.includes("html") || extension === "html" || extension === "htm")
    return "html";
  if (mimeType.includes("json") || extension === "json") return "json";
  if (mimeType.includes("csv") || extension === "csv") return "csv";
  return "file";
};

// Helper function to map document status
const mapDocumentStatus = (
  documentStatus: string,
  processingStatus?: string
): string => {
  if (processingStatus === "processing" || processingStatus === "queued") {
    return "processing";
  }
  if (processingStatus === "error") {
    return "error";
  }
  if (documentStatus === "PUBLISHED") {
    return "active";
  }
  if (documentStatus === "ARCHIVED") {
    return "archived";
  }
  return "draft";
};

const handleSearch = () => {
  // Search is reactive through computed property
};

const applyFilters = () => {
  // Filters are reactive through computed property
};

const clearFilters = () => {
  searchQuery.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  selectedDocuments.value = [];
};

const toggleDocumentSelection = (documentId: string) => {
  const index = selectedDocuments.value.indexOf(documentId);
  if (index > -1) {
    selectedDocuments.value.splice(index, 1);
  } else {
    selectedDocuments.value.push(documentId);
  }
};

const toggleAllSelection = () => {
  if (allSelected.value) {
    selectedDocuments.value = [];
  } else {
    selectedDocuments.value = filteredDocuments.value.map((doc) => doc.id);
  }
};

const viewDocument = (document: any) => {
  // TODO: Open document viewer
  console.log("View document:", document);
};

const downloadDocument = async (document: any) => {
  try {
    // TODO: Download document via API
    console.log("Download document:", document);
    // TODO: Show success notification
    console.log("Document download started");
  } catch (error) {
    console.error("Error downloading document:", error);
    // TODO: Show error notification
    console.error("Failed to download document");
  }
};

const editDocument = (document: any) => {
  // TODO: Open edit dialog
  console.log("Edit document:", document);
};

const archiveDocument = async (document: any) => {
  try {
    // TODO: Archive/unarchive via API
    document.status = document.status === "archived" ? "active" : "archived";
    // TODO: Show success notification
    console.log(
      `Document ${
        document.status === "archived" ? "archived" : "unarchived"
      } successfully`
    );
  } catch (error) {
    console.error("Error archiving document:", error);
    // TODO: Show error notification
    console.error("Failed to archive document");
  }
};

const deleteDocument = async (document: any) => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Delete via API
    const index = documents.value.findIndex((d) => d.id === document.id);
    if (index > -1) {
      documents.value.splice(index, 1);
    }
    // TODO: Show success notification
    console.log("Document deleted successfully");
  } catch (error) {
    console.error("Error deleting document:", error);
    // TODO: Show error notification
    console.error("Failed to delete document");
  }
};

const bulkArchive = async () => {
  try {
    // TODO: Bulk archive via API
    console.log("Bulk archive:", selectedDocuments.value);
    selectedDocuments.value = [];
    // TODO: Show success notification
    console.log("Documents archived successfully");
  } catch (error) {
    console.error("Error archiving documents:", error);
    // TODO: Show error notification
    console.error("Failed to archive documents");
  }
};

const bulkDownload = async () => {
  try {
    // TODO: Bulk download via API
    console.log("Bulk download:", selectedDocuments.value);
    // TODO: Show success notification
    console.log("Download started");
  } catch (error) {
    console.error("Error downloading documents:", error);
    // TODO: Show error notification
    console.error("Failed to download documents");
  }
};

const bulkDelete = async () => {
  try {
    // TODO: Show confirmation dialog
    // TODO: Bulk delete via API
    documents.value = documents.value.filter(
      (doc) => !selectedDocuments.value.includes(doc.id)
    );
    selectedDocuments.value = [];
    // TODO: Show success notification
    console.log("Documents deleted successfully");
  } catch (error) {
    console.error("Error deleting documents:", error);
    // TODO: Show error notification
    console.error("Failed to delete documents");
  }
};

// Lifecycle
onMounted(async () => {
  await refreshData();
});

// SEO
useHead({
  title: "Documents - Hay Dashboard",
  meta: [
    { name: "description", content: "Manage your knowledge base documents" },
  ],
});
</script>
