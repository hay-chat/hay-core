<template>
  <Page :title="$t('documents.page.title')" :description="$t('documents.page.description')">
    <!-- Page Header -->
    <template #header>
      <div class="mt-4 sm:mt-0 flex space-x-3">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
          {{ $t("documents.actions.refresh") }}
        </Button>
        <NuxtLink to="/documents/new">
          <Button variant="outline">
            <FilePlus class="mr-2 h-4 w-4" />
            {{ $t("documents.actions.writeDocument") }}
          </Button>
        </NuxtLink>
        <NuxtLink to="/documents/import">
          <Button>
            <Upload class="mr-2 h-4 w-4" />
            {{ $t("documents.actions.importDocument") }}
          </Button>
        </NuxtLink>
      </div>
    </template>

    <!-- Search and Filter -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <div class="relative">
          <Search
            class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-muted"
          />
          <Input
            v-model="searchQuery"
            :placeholder="$t('documents.search.placeholder')"
            class="pl-10"
            @keyup.enter="searchDocuments"
          />
        </div>
      </div>
      <Button :disabled="!searchQuery || searching" @click="searchDocuments">
        {{ searching ? $t("documents.actions.searching") : $t("documents.actions.search") }}
      </Button>
      <div class="flex gap-2">
        <select
          v-model="typeFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">{{ $t("documents.filters.allTypes") }}</option>
          <option value="article">{{ $t("documents.filters.article") }}</option>
          <option value="guide">{{ $t("documents.filters.guide") }}</option>
          <option value="faq">{{ $t("documents.filters.faq") }}</option>
          <option value="tutorial">{{ $t("documents.filters.tutorial") }}</option>
          <option value="reference">{{ $t("documents.filters.reference") }}</option>
          <option value="policy">{{ $t("documents.filters.policy") }}</option>
        </select>
        <select
          v-model="statusFilter"
          class="px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @change="applyFilters"
        >
          <option value="">{{ $t("documents.filters.allStatus") }}</option>
          <option value="published">{{ $t("documents.filters.published") }}</option>
          <option value="processing">{{ $t("documents.filters.processing") }}</option>
          <option value="draft">{{ $t("documents.filters.draft") }}</option>
          <option value="archived">{{ $t("documents.filters.archived") }}</option>
          <option value="error">{{ $t("documents.filters.error") }}</option>
        </select>
      </div>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="errorDocumentsCount > 0"
      class="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <AlertCircle class="h-5 w-5 text-red-600 dark:text-red-500 flex-shrink-0" />
          <div>
            <p class="text-sm font-medium text-red-900 dark:text-red-300">
              {{
                $t(
                  "documents.errorBanner.failedToProcess",
                  { count: errorDocumentsCount },
                  errorDocumentsCount,
                )
              }}
            </p>
            <p class="text-xs text-red-700 dark:text-red-400 mt-0.5">
              {{ $t("documents.errorBanner.needsAttention") }}
            </p>
          </div>
        </div>
        <div class="flex space-x-2">
          <Button variant="outline" size="sm" @click="viewFailedDocuments">
            {{ $t("documents.actions.viewFailed") }}
          </Button>
          <Button size="sm" :disabled="retryingAll" @click="retryAllFailed">
            <RotateCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': retryingAll }" />
            {{ retryingAll ? $t("documents.actions.retrying") : $t("documents.actions.retryAll") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Bulk Actions -->
    <div v-if="selectedDocuments.length > 0" class="bg-background-tertiary p-4 rounded-lg">
      <div class="flex items-center justify-between">
        <p class="text-sm text-foreground">
          {{
            $t(
              "documents.bulk.selected",
              { count: selectedDocuments.length },
              selectedDocuments.length,
            )
          }}
        </p>
        <div class="flex space-x-2">
          <Button variant="outline" size="sm" @click="bulkArchive">
            <Archive class="mr-2 h-4 w-4" />
            {{ $t("documents.actions.archive") }}
          </Button>
          <Button variant="outline" size="sm" @click="bulkDownload">
            <Download class="mr-2 h-4 w-4" />
            {{ $t("documents.actions.download") }}
          </Button>
          <Button variant="destructive" size="sm" @click="bulkDelete">
            <Trash2 class="mr-2 h-4 w-4" />
            {{ $t("documents.actions.delete") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Documents Table -->
    <div
      v-if="!loading && documents.length > 0"
      class="bg-background rounded-lg border overflow-x-auto"
    >
      <Table class="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead class="w-12">
              <Checkbox :checked="allSelected" @update:checked="toggleAllSelection" />
            </TableHead>
            <TableHead class="w-auto">{{ $t("documents.table.name") }}</TableHead>
            <TableHead class="w-24">{{ $t("documents.table.type") }}</TableHead>
            <TableHead class="w-32">{{ $t("documents.table.status") }}</TableHead>
            <TableHead class="w-44">{{ $t("documents.table.lastModified") }}</TableHead>
            <TableHead class="w-12 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="document in documents"
            :key="document.id"
            :class="selectedDocuments.includes(document.id) ? 'bg-background-secondary' : ''"
          >
            <TableCell>
              <Checkbox
                :checked="selectedDocuments.includes(document.id)"
                @update:checked="toggleDocumentSelection(document.id)"
              />
            </TableCell>
            <TableCell class="font-medium max-w-0">
              <NuxtLink
                :to="`/documents/${document.id}`"
                class="flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
              >
                <component
                  :is="getFileIcon(document.type)"
                  class="h-4 w-4 min-w-4 flex-shrink-0 text-neutral-muted"
                />
                <span class="truncate block" :title="document.title || document.name">
                  {{ document.title || document.name }}
                </span>
              </NuxtLink>
            </TableCell>
            <TableCell>
              <span
                class="inline-flex items-center px-2 py-1 rounded-md bg-background-tertiary text-xs whitespace-nowrap"
              >
                {{ document.type ? $t(`documents.filters.${document.type}`) : "DOC" }}
              </span>
            </TableCell>
            <TableCell>
              <div
                :class="[
                  'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap',
                  document.status === 'published'
                    ? 'bg-green-100 text-green-800'
                    : document.status === 'processing'
                      ? 'bg-blue-100 text-blue-800'
                      : document.status === 'draft'
                        ? 'bg-yellow-100 text-yellow-800'
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
                        : document.status === 'draft'
                          ? 'bg-yellow-600 animate-pulse'
                          : document.status === 'archived'
                            ? 'bg-gray-600'
                            : 'bg-red-600',
                  ]"
                />
                {{ $t(`documents.filters.${document.status}`) }}
              </div>
            </TableCell>
            <TableCell class="whitespace-nowrap">
              {{ formatDateTime(document.updatedAt) }}
            </TableCell>
            <TableCell class="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                    <MoreVertical class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="$router.push(`/documents/${document.id}`)">
                    <Eye class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.view") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="document.importMethod === 'web' && document.sourceUrl"
                    @click="visitSourcePage(document)"
                  >
                    <ExternalLink class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.visitPage") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-else-if="document.hasAttachment"
                    @click="downloadDocument(document)"
                  >
                    <Download class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.download") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="editDocument(document)">
                    <Edit class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.edit") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="document.sourceUrl && document.importMethod === 'web'"
                    @click="recrawlDocument(document)"
                  >
                    <RefreshCw class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.updateFromSource") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="document.status === 'error'"
                    @click="retryDocument(document)"
                  >
                    <RotateCw class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.retryProcessing") }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @click="archiveDocument(document)">
                    <Archive class="mr-2 h-4 w-4" />
                    {{
                      document.status === "archived"
                        ? $t("documents.actions.unarchive")
                        : $t("documents.actions.archive")
                    }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="text-destructive"
                    @click="() => deleteDocument(document)"
                  >
                    <Trash2 class="mr-2 h-4 w-4" />
                    {{ $t("documents.actions.delete") }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Empty State -->
    <EmptyState
      v-else-if="!loading && documents.length === 0"
      :title="
        searchQuery || typeFilter || statusFilter
          ? $t('documents.empty.noDocumentsFound')
          : $t('documents.empty.noDocumentsYet')
      "
      :description="
        searchQuery || typeFilter || statusFilter
          ? $t('documents.empty.adjustFilters')
          : $t('documents.empty.getStarted')
      "
      illustration="/bale/document.svg"
      :action="
        searchQuery || typeFilter || statusFilter
          ? $t('documents.actions.clearFilters')
          : $t('documents.actions.importDocument')
      "
      @click="
        searchQuery || typeFilter || statusFilter
          ? clearFilters()
          : $router.push('/documents/import')
      "
    />

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
      :confirm-text="$t('documents.actions.delete')"
      :destructive="true"
      @confirm="confirmDelete"
    />

    <!-- Upload Dialog -->
    <Dialog v-model:open="showUploadDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("documents.uploadDialog.title") }}</DialogTitle>
          <DialogDescription>
            {{ $t("documents.uploadDialog.description") }}
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div>
            <Label for="title">{{ $t("documents.uploadDialog.titleLabel") }}</Label>
            <Input
              id="title"
              v-model="uploadForm.title"
              :placeholder="$t('documents.uploadDialog.titlePlaceholder')"
            />
          </div>

          <div>
            <Label for="content">{{ $t("documents.uploadDialog.contentLabel") }}</Label>
            <Textarea
              id="content"
              v-model="uploadForm.content"
              :placeholder="$t('documents.uploadDialog.contentPlaceholder')"
              :rows="4"
            />
          </div>

          <div>
            <Label>{{ $t("documents.uploadDialog.orUploadFile") }}</Label>
            <div class="mt-2">
              <input
                type="file"
                accept=".txt,.md,.pdf"
                class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                @change="handleFileUpload"
              />
              <p class="text-xs text-neutral-muted mt-2">
                {{ $t("documents.uploadDialog.supportedFormats") }}
              </p>
            </div>
          </div>

          <div class="flex justify-end space-x-2">
            <Button variant="outline" @click="showUploadDialog = false">
              {{ $t("common.cancel") }}
            </Button>
            <Button :disabled="uploading" @click="uploadDocument">
              {{
                uploading
                  ? $t("documents.uploadDialog.uploading")
                  : $t("documents.uploadDialog.upload")
              }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useWebSocket } from "@/composables/useWebSocket";

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
  RotateCw,
  AlertCircle,
  ExternalLink,
  FilePlus,
} from "lucide-vue-next";

const { t } = useI18n();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

// State
const loading = ref(false);
const searching = ref(false);
const searchQuery = ref("");
const retryingAll = ref(false);
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
  importMethod?: "upload" | "web" | "plugin";
  hasAttachment?: boolean;
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

const allSelected = computed(() => {
  return (
    documents.value.length > 0 &&
    documents.value.every((doc) => selectedDocuments.value.includes(doc.id))
  );
});

const errorDocumentsCount = computed(() => {
  return documents.value.filter((doc) => doc.status === "error").length;
});

const errorDocuments = computed(() => {
  return documents.value.filter((doc) => doc.status === "error");
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

const refreshData = async () => {
  loading.value = true;
  try {
    const filters: Record<string, string> = {};
    if (typeFilter.value) filters.type = typeFilter.value;
    if (statusFilter.value) filters.status = statusFilter.value;

    const result = await HayApi.documents.list.query({
      pagination: { page: currentPage.value, limit: pageSize.value },
      ...(Object.keys(filters).length > 0 && { filters }),
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
      sourceUrl: doc.sourceUrl as string | undefined,
      importMethod: doc.importMethod as "upload" | "web" | "plugin" | undefined,
      hasAttachment: !!(doc.attachments as Array<unknown>)?.length,
    }));
    totalDocuments.value = result.pagination.total;
  } catch (error) {
    console.error("Failed to fetch documents:", error);
  } finally {
    loading.value = false;
  }
};

// Search documents using hybrid search (vector + keyword)
const searchDocuments = async () => {
  if (!searchQuery.value.trim()) return;

  searching.value = true;
  try {
    const results = await HayApi.documents.search.query({
      query: searchQuery.value,
      limit: 20,
    });

    // Update the main documents list with search results
    documents.value = (results || []).map((doc: any) => ({
      id: doc.id,
      name: doc.title || "Untitled",
      title: doc.title,
      description: doc.content,
      type: doc.type,
      status: doc.status,
      category: "search-result",
      fileSize: 0,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
      sourceUrl: doc.sourceUrl,
      importMethod: doc.importMethod,
      hasAttachment: doc.hasAttachment,
    }));
    totalDocuments.value = documents.value.length;
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
  currentPage.value = 1;
  selectedDocuments.value = [];
  refreshData();
};

const clearFilters = () => {
  searchQuery.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  selectedDocuments.value = [];
  currentPage.value = 1;
  refreshData();
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
    selectedDocuments.value = documents.value.map((doc) => doc.id);
  }
};

const visitSourcePage = (document: Document) => {
  if (document.sourceUrl) {
    window.open(document.sourceUrl, "_blank", "noopener,noreferrer");
  }
};

const downloadDocument = async (document: Document) => {
  try {
    // Get the download URL from the API
    const result = await HayApi.documents.getDownloadUrl.query({
      documentId: document.id,
    });

    if (result.type === "web") {
      // For web documents, open the source URL
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else if (result.type === "file" && result.url) {
      // For file uploads, trigger a download
      const link = window.document.createElement("a");
      link.href = result.url;
      link.download = result.fileName || "document";
      link.target = "_blank";
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      toast.success(t("documents.toast.downloadStarted"));
    }
  } catch (error) {
    console.error("Error downloading document:", error);
    toast.error(t("documents.toast.downloadFailed"));
  }
};

const editDocument = (document: Document) => {
  router.push(`/documents/${document.id}`);
};

const recrawlDocument = async (document: Document) => {
  try {
    const _response = await HayApi.documents.recrawl.mutate({
      documentId: document.id,
    });

    toast.success(t("documents.toast.updateStarted", { name: document.title || document.name }));

    // Optionally redirect to job queue
    // router.push('/queue');
  } catch (error) {
    console.error("Recrawl error:", error);
    toast.error(t("documents.toast.updateFailed"));
  }
};

const archiveDocument = async (document: Document) => {
  try {
    // TODO: Archive/unarchive via API
    document.status = document.status === "archived" ? "active" : "archived";
    toast.success(
      document.status === "archived"
        ? t("documents.toast.archiveSuccess")
        : t("documents.toast.unarchiveSuccess"),
    );
  } catch (error) {
    console.error("Error archiving document:", error);
    toast.error(t("documents.toast.archiveFailed"));
  }
};

const deleteDocument = (document: Document) => {
  documentToDelete.value = document;
  isBulkDelete.value = false;
  deleteDialogTitle.value = t("documents.deleteDialog.title");
  deleteDialogDescription.value = t("documents.deleteDialog.confirmSingle", {
    name: document.name,
  });

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
    toast.success(t("documents.toast.bulkArchiveSuccess"));
  } catch (error) {
    console.error("Error archiving documents:", error);
    toast.error(t("documents.toast.bulkArchiveFailed"));
  }
};

const bulkDownload = async () => {
  try {
    // TODO: Bulk download via API
    console.log("Bulk download:", selectedDocuments.value);
    toast.info(t("documents.toast.bulkDownloadStarted"));
  } catch (error) {
    console.error("Error downloading documents:", error);
    toast.error(t("documents.toast.bulkDownloadFailed"));
  }
};

const bulkDelete = () => {
  if (selectedDocuments.value.length === 0) return;

  isBulkDelete.value = true;
  deleteDialogTitle.value = t("documents.deleteDialog.titlePlural");
  deleteDialogDescription.value = t(
    "documents.deleteDialog.confirmBulk",
    { count: selectedDocuments.value.length },
    selectedDocuments.value.length,
  );
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

      toast.success(result.message || t("documents.toast.deleteSuccess"));
    }
  } catch (error) {
    console.error("Error deleting document:", error);
    toast.error(t("documents.toast.deleteFailed"));
  } finally {
    documentToDelete.value = null;
  }
};

const performBulkDelete = async () => {
  const errors: string[] = [];
  const successfulDeletes: string[] = [];
  const totalCount = selectedDocuments.value.length;

  // Show initial progress toast with no auto-dismiss
  const progressToastId = toast.info(
    t("documents.toast.bulkDeleteProgress", { current: 0, total: totalCount }),
    undefined,
    0,
  );

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
          toast.update(
            progressToastId,
            t("documents.toast.bulkDeleteProgress", { current: deletedCount, total: totalCount }),
          );
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
        t("documents.toast.bulkDeletePartial", {
          success: successfulDeletes.length,
          failed: errors.length,
        }),
      );
    } else {
      toast.success(t("documents.toast.bulkDeleteSuccess", { count: successfulDeletes.length }));
    }
  } catch (error) {
    console.error("Error deleting documents:", error);
    toast.remove(progressToastId);
    toast.error(t("documents.toast.bulkDeleteFailed"));
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

const retryDocument = async (document: Document) => {
  const previousStatus = document.status;
  try {
    // Set processing immediately so the UI updates before the API call
    document.status = "processing";

    await HayApi.documents.retryDocument.mutate({
      documentId: document.id,
    });

    // Toast will be shown by the WebSocket handler when processing
    // completes with "published" or "error" status
  } catch (error) {
    console.error("Error retrying document:", error);
    toast.error(t("documents.toast.retryFailed"));
    document.status = previousStatus;
  }
};

const viewFailedDocuments = () => {
  statusFilter.value = "error";
  currentPage.value = 1;
  refreshData();
};

const retryAllFailed = async () => {
  if (errorDocuments.value.length === 0) return;

  retryingAll.value = true;
  const totalCount = errorDocuments.value.length;
  let successCount = 0;
  let failureCount = 0;

  const progressToastId = toast.info(
    t("documents.toast.retryProgress", { current: 0, total: totalCount }),
    undefined,
    0,
  );

  try {
    for (const document of errorDocuments.value) {
      try {
        await HayApi.documents.retryDocument.mutate({
          documentId: document.id,
        });

        document.status = "processing";
        successCount++;
        toast.update(
          progressToastId,
          t("documents.toast.retryProgress", {
            current: successCount + failureCount,
            total: totalCount,
          }),
        );
      } catch (error) {
        console.error(`Failed to retry document ${document.id}:`, error);
        failureCount++;
        toast.update(
          progressToastId,
          t("documents.toast.retryProgress", {
            current: successCount + failureCount,
            total: totalCount,
          }),
        );
      }
    }

    toast.remove(progressToastId);

    if (failureCount > 0) {
      toast.warning(
        t("documents.toast.retryPartial", { success: successCount, failed: failureCount }),
      );
    } else {
      toast.success(t("documents.toast.retrySuccess", { count: successCount }));
    }
  } catch (error) {
    console.error("Error retrying documents:", error);
    toast.remove(progressToastId);
    toast.error(t("documents.toast.retryAllFailed"));
  } finally {
    retryingAll.value = false;
  }
};

// WebSocket setup
const websocket = useWebSocket();

// Lifecycle
onMounted(async () => {
  await refreshData();

  // Set up WebSocket connection and listeners
  websocket.connect();

  // Listen for document status updates
  const unsubscribe = websocket.on("document:status-updated", (data: any) => {
    console.log("[Documents] Received document status update:", data);

    if (!data?.documentId || !data?.status) {
      console.warn("[Documents] Invalid document status update payload:", data);
      return;
    }

    // Find the document in the local list and update its status
    const document = documents.value.find((doc) => doc.id === data.documentId);
    if (document) {
      const oldStatus = document.status;
      document.status = data.status;

      console.log(
        `[Documents] Updated document ${data.documentId} status: ${oldStatus} → ${data.status}`,
      );

      // Show toast notification for status changes (skip during batch retry)
      if (!retryingAll.value) {
        if (data.status === "published") {
          toast.success(
            t("documents.toast.processedSuccess", { name: document.title || document.name }),
          );
        } else if (data.status === "error") {
          toast.error(
            t("documents.toast.processedError", { name: document.title || document.name }),
          );
        }
      }
    }
  });

  // Clean up on unmount
  onUnmounted(() => {
    unsubscribe();
  });
});

// SEO
useHead({
  title: t("documents.page.seoTitle"),
  meta: [{ name: "description", content: t("documents.page.seoDescription") }],
});
</script>
