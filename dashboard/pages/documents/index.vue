<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">Documents</h1>
        <p class="mt-1 text-sm text-neutral-muted">
          Manage your knowledge base documents for AI agents.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
        <NuxtLink to="/documents/import">
          <Button>
            <Upload class="mr-2 h-4 w-4" />
            Import Document
          </Button>
        </NuxtLink>
      </div>
    </div>

    <!-- Search and Filter -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-muted"
          />
          <Input
            v-model="searchQuery"
            placeholder="Search documents using natural language..."
            class="pl-10"
            @keyup.enter="searchDocuments"
          />
        </div>
      </div>
      <Button :disabled="!searchQuery || searching" @click="searchDocuments">
        {{ searching ? "Searching..." : "Search" }}
      </Button>
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
    <div v-if="selectedDocuments.length > 0" class="bg-background-tertiary p-4 rounded-lg">
      <div class="flex items-center justify-between">
        <p class="text-sm text-foreground">
          {{ selectedDocuments.length }} document{{ selectedDocuments.length === 1 ? "" : "s" }}
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
    <div v-if="!loading && filteredDocuments.length > 0" class="bg-background rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-12">
              <Checkbox :checked="allSelected" @update:checked="toggleAllSelection" />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Modified</TableHead>
            <TableHead class="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="document in filteredDocuments"
            :key="document.id"
            :class="selectedDocuments.includes(document.id) ? 'bg-background-secondary' : ''"
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
                  class="h-4 w-4 min-w-4 text-neutral-muted"
                />
                <div class="truncate" :title="document.title || document.name">
                  {{ document.title || document.name }}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <span
                class="inline-flex items-center px-2 py-1 rounded-md bg-background-tertiary text-xs"
              >
                {{ document.type ? document.type.toUpperCase() : "DOC" }}
              </span>
            </TableCell>
            <TableCell>
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                  document.status === 'published'
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
                    document.status === 'published'
                      ? 'bg-green-600'
                      : document.status === 'processing'
                        ? 'bg-blue-600 animate-pulse'
                        : document.status === 'archived'
                          ? 'bg-gray-600'
                          : 'bg-red-600',
                  ]"
                />
                {{ document.status }}
              </div>
            </TableCell>
            <TableCell>{{ formatDate(document.updatedAt) }}</TableCell>
            <TableCell class="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
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
                  <DropdownMenuItem
                    v-if="document.sourceUrl && document.importMethod === 'web'"
                    @click="recrawlDocument(document)"
                  >
                    <RefreshCw class="mr-2 h-4 w-4" />
                    Update from Source
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="archiveDocument(document)">
                    <Archive class="mr-2 h-4 w-4" />
                    {{ document.status === "archived" ? "Unarchive" : "Archive" }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="text-destructive"
                    @click="() => deleteDocument(document)"
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
    <div v-else-if="!loading && filteredDocuments.length === 0" class="text-center py-12">
      <img src="/bale/document.svg" class="h-32 w-32 mx-auto" />
      <h3 class="text-lg font-medium text-foreground">
        {{ searchQuery || typeFilter || statusFilter ? "No documents found" : "No documents yet" }}
      </h3>
      <p class="mt-2 text-sm text-neutral-muted">
        {{
          searchQuery || typeFilter || statusFilter
            ? "Try adjusting your search or filters."
            : "Get started by uploading your first document."
        }}
      </p>
      <div class="mt-6">
        <Button v-if="searchQuery || typeFilter || statusFilter" @click="clearFilters()">
          Clear Filters
        </Button>
        <NuxtLink v-else to="/documents/import">
          <Button>Import Document</Button>
        </NuxtLink>
      </div>
    </div>

    <!-- Pagination -->
    <DataPagination
      v-if="!loading && totalDocuments > 0"
      :current-page="currentPage"
      :total-pages="totalPages"
      :items-per-page="pageSize"
      :total-items="totalDocuments"
      @page-change="handlePageChange"
      @items-per-page-change="handleItemsPerPageChange"
    />

    <!-- Search Results -->
    <div v-if="searchResults.length > 0" class="space-y-4">
      <h3 class="text-lg font-semibold">Search Results</h3>
      <div class="grid gap-4">
        <Card v-for="result in searchResults" :key="result.id">
          <CardHeader>
            <CardTitle class="text-base">
              {{ result.title }}
            </CardTitle>
            <CardDescription>
              Similarity: {{ (result.similarity * 100).toFixed(2) }}%

              {{ result }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-neutral-muted">
              {{ result.content }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="animate-pulse">
        <div class="bg-background-tertiary rounded-lg p-4 flex items-center space-x-4">
          <div class="h-10 w-10 bg-background-tertiary-foreground/20 rounded" />
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-background-tertiary-foreground/20 rounded w-1/4" />
            <div class="h-3 bg-background-tertiary-foreground/20 rounded w-1/2" />
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm Delete Dialog -->
    <ConfirmDialog
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      confirm-text="Delete"
      :destructive="true"
      @confirm="confirmDelete"
    />

    <!-- Upload Dialog -->
    <Dialog v-model:open="showUploadDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload a document to create embeddings for semantic search
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <Label for="title">Title</Label>
            <Input id="title" v-model="uploadForm.title" placeholder="Enter document title" />
          </div>

          <div>
            <Label for="content">Content</Label>
            <Textarea
              id="content"
              v-model="uploadForm.content"
              placeholder="Enter or paste document content"
              :rows="4"
            />
          </div>

          <div>
            <Label>Or Upload File</Label>
            <div class="mt-2">
              <input
                type="file"
                accept=".txt,.md,.pdf"
                class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                @change="handleFileUpload"
              />
              <p class="text-xs text-neutral-muted mt-2">Supported formats: .txt, .md, .pdf</p>
            </div>
          </div>

          <div class="flex justify-end space-x-2">
            <Button variant="outline" @click="showUploadDialog = false"> Cancel </Button>
            <Button :disabled="uploading" @click="uploadDocument">
              {{ uploading ? "Uploading..." : "Upload" }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import DataPagination from "@/components/DataPagination.vue";
import { useToast } from "@/composables/useToast";

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
  FileCode,
  FileJson,
  File,
} from "lucide-vue-next";

// State
const loading = ref(false);
const searching = ref(false);
const searchQuery = ref("");
interface SearchResult {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  similarity: number;
}

const searchResults = ref<SearchResult[]>([]);
const typeFilter = ref("");
const statusFilter = ref("");
const selectedDocuments = ref<string[]>([]);
interface Document {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type: string;
  category: string;
  fileSize: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  sourceUrl?: string;
  importMethod?: string;
}

const documents = ref<Document[]>([]);
const currentPage = ref(1);
const pageSize = ref(10);
const totalDocuments = ref(0);

// Computed total pages
const totalPages = computed(() => Math.ceil(totalDocuments.value / pageSize.value));
const showUploadDialog = ref(false);
const uploading = ref(false);
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref("");
const deleteDialogDescription = ref("");
const documentToDelete = ref<Document | null>(null);
const isBulkDelete = ref(false);

const uploadForm = ref({
  title: "",
  content: "",
  fileBuffer: "",
  mimeType: "",
  fileName: "",
});

const toast = useToast();

// Computed
const filteredDocuments = computed(() => {
  let filtered = documents.value;

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (doc) =>
        doc.name.toLowerCase().includes(query) || doc.description?.toLowerCase().includes(query),
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
    filteredDocuments.value.every((doc) => selectedDocuments.value.includes(doc.id))
  );
});

// Methods
const _getHostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

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

const _formatFileSize = (bytes: number) => {
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
  loading.value = true;
  try {
    const result = await HayApi.documents.list.query({
      pagination: { page: currentPage.value, limit: pageSize.value },
    });

    // Map the result to the expected document format
    documents.value = (result.items || []).map((doc: Record<string, unknown>) => ({
      id: doc.id as string,
      name: (doc.title as string) || "Untitled",
      description: (doc.description as string) || (doc.content as string)?.substring(0, 100),
      type: (doc.type as string) || "article",
      category: (doc.categories as string[])?.[0] || "general",
      fileSize: (doc.attachments as Array<{ size: number }>)?.[0]?.size || 0,
      status: (doc.status as string) || "draft",
      createdAt: new Date((doc.created_at || doc.createdAt) as string),
      updatedAt: new Date((doc.updated_at || doc.updatedAt) as string),
    }));
    totalDocuments.value = result.pagination.total;
  } catch (error) {
    console.error("Failed to fetch documents:", error);
  } finally {
    loading.value = false;
  }
};

// Search documents using vector similarity
const searchDocuments = async () => {
  if (!searchQuery.value.trim()) return;

  searching.value = true;
  try {
    const results = await HayApi.documents.search.query({
      query: searchQuery.value,
      limit: 20,
    });

    // Map search results to document format
    searchResults.value = (results || []).map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      type: doc.type,
      status: doc.status,
      similarity: doc.similarity || 0,
    }));

    // Also update the main documents list with search results
    documents.value = searchResults.value.map((doc: any) => ({
      id: doc.id,
      name: doc.title,
      title: doc.title,
      description: doc.content,
      type: doc.type,
      status: doc.status,
      similarity: doc.similarity,
      category: "search-result",
      fileSize: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  } catch (error) {
    console.error("Search failed:", error);
  } finally {
    searching.value = false;
  }
};

// Pagination handlers
const handlePageChange = async (page: number) => {
  currentPage.value = page;
  await refreshData();
};

const handleItemsPerPageChange = async (itemsPerPage: number) => {
  pageSize.value = itemsPerPage;
  currentPage.value = 1; // Reset to first page when changing page size
  await refreshData();
};

// Load documents on mount
onMounted(() => {
  refreshData();
});

// Helper function to detect file type from MIME type or extension
const _detectFileType = (mimeType: string, extension: string): string => {
  if (mimeType.includes("pdf") || extension === "pdf") return "pdf";
  if (mimeType.includes("word") || extension === "docx" || extension === "doc") return "doc";
  if (mimeType.includes("text/plain") || extension === "txt") return "txt";
  if (mimeType.includes("markdown") || extension === "md") return "md";
  if (mimeType.includes("html") || extension === "html" || extension === "htm") return "html";
  if (mimeType.includes("json") || extension === "json") return "json";
  if (mimeType.includes("csv") || extension === "csv") return "csv";
  return "file";
};

// Helper function to map document status
const _mapDocumentStatus = (documentStatus: string, processingStatus?: string): string => {
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

const viewDocument = (document: Document) => {
  // TODO: Open document viewer
  console.log("View document:", document);
};

const downloadDocument = async (document: Document) => {
  try {
    // TODO: Download document via API
    console.log("Download document:", document);
    toast.info("Document download started");
  } catch (error) {
    console.error("Error downloading document:", error);
    toast.error("Failed to download document");
  }
};

const editDocument = (document: Document) => {
  // TODO: Open edit dialog
  console.log("Edit document:", document);
};

const recrawlDocument = async (document: Document) => {
  try {
    const _response = await HayApi.documents.recrawl.mutate({
      documentId: document.id,
    });

    toast.success(
      `Update started for ${document.title || document.name}. Check the job queue for progress.`,
    );

    // Optionally redirect to job queue
    // router.push('/queue');
  } catch (error) {
    console.error("Recrawl error:", error);
    toast.error("Failed to start document update");
  }
};

const archiveDocument = async (document: Document) => {
  try {
    // TODO: Archive/unarchive via API
    document.status = document.status === "archived" ? "active" : "archived";
    toast.success(
      `Document ${document.status === "archived" ? "archived" : "unarchived"} successfully`,
    );
  } catch (error) {
    console.error("Error archiving document:", error);
    toast.error("Failed to archive document");
  }
};

const deleteDocument = (document: Document) => {
  documentToDelete.value = document;
  isBulkDelete.value = false;
  deleteDialogTitle.value = "Delete Document";
  deleteDialogDescription.value = `Are you sure you want to delete "${document.name}"? This action cannot be undone and will also delete all associated embeddings.`;

  // Use nextTick to ensure state is settled before opening dialog
  nextTick(() => {
    showDeleteDialog.value = true;
  });
};

const bulkArchive = async () => {
  try {
    // TODO: Bulk archive via API
    console.log("Bulk archive:", selectedDocuments.value);
    selectedDocuments.value = [];
    toast.success("Documents archived successfully");
  } catch (error) {
    console.error("Error archiving documents:", error);
    toast.error("Failed to archive documents");
  }
};

const bulkDownload = async () => {
  try {
    // TODO: Bulk download via API
    console.log("Bulk download:", selectedDocuments.value);
    toast.info("Download started");
  } catch (error) {
    console.error("Error downloading documents:", error);
    toast.error("Failed to download documents");
  }
};

const bulkDelete = () => {
  if (selectedDocuments.value.length === 0) return;

  isBulkDelete.value = true;
  deleteDialogTitle.value = "Delete Documents";
  deleteDialogDescription.value = `Are you sure you want to delete ${
    selectedDocuments.value.length
  } document${
    selectedDocuments.value.length === 1 ? "" : "s"
  }? This action cannot be undone and will also delete all associated embeddings.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (isBulkDelete.value) {
    await performBulkDelete();
  } else {
    await performSingleDelete();
  }
};

const performSingleDelete = async () => {
  if (!documentToDelete.value) return;

  try {
    const result = await HayApi.documents.delete.mutate({
      id: documentToDelete.value!.id,
    });

    if (result.success) {
      const index = documents.value.findIndex((d) => d.id === documentToDelete.value!.id);
      if (index > -1) {
        documents.value.splice(index, 1);
      }

      toast.success(result.message || "Document deleted successfully");
    }
  } catch (error) {
    console.error("Error deleting document:", error);
    toast.error("Failed to delete document. Please try again.");
  } finally {
    documentToDelete.value = null;
  }
};

const performBulkDelete = async () => {
  const errors: string[] = [];
  const successfulDeletes: string[] = [];
  const totalCount = selectedDocuments.value.length;

  // Show initial progress toast with no auto-dismiss
  const progressToastId = toast.info(`Deleting documents... 0/${totalCount}`, undefined, 0);

  try {
    let deletedCount = 0;

    for (const documentId of selectedDocuments.value) {
      try {
        const result = await HayApi.documents.delete.mutate({
          id: documentId,
        });

        if (result.success) {
          successfulDeletes.push(documentId);
          deletedCount++;

          // Update progress toast
          toast.update(progressToastId, `Deleting documents... ${deletedCount}/${totalCount}`);
        }
      } catch (error) {
        errors.push(documentId);
        deletedCount++;
        console.error(`Error deleting document ${documentId}:`, error);

        // Update progress toast even for errors
        toast.update(progressToastId, `Deleting documents... ${deletedCount}/${totalCount}`);
      }
    }

    // Remove the progress toast
    toast.remove(progressToastId);

    documents.value = documents.value.filter((doc) => !successfulDeletes.includes(doc.id));

    selectedDocuments.value = [];

    if (errors.length > 0) {
      toast.warning(
        `Successfully deleted ${successfulDeletes.length} document(s). Failed to delete ${errors.length} document(s).`,
      );
    } else {
      toast.success(`Successfully deleted ${successfulDeletes.length} document(s)`);
    }
  } catch (error) {
    console.error("Error deleting documents:", error);
    toast.remove(progressToastId);
    toast.error("Failed to delete documents. Please try again.");
  }
};

const handleFileUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const arrayBuffer = e.target?.result as ArrayBuffer;
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );

    uploadForm.value.fileBuffer = base64;
    uploadForm.value.mimeType = file.type || "text/plain";
    uploadForm.value.fileName = file.name;

    if (!uploadForm.value.title) {
      uploadForm.value.title = file.name.replace(/\.[^/.]+$/, "");
    }
  };

  reader.readAsArrayBuffer(file);
};

const uploadDocument = async () => {};

// Lifecycle
onMounted(async () => {
  await refreshData();
});

// SEO
useHead({
  title: "Documents - Hay Dashboard",
  meta: [{ name: "description", content: "Manage your knowledge base documents" }],
});
</script>
