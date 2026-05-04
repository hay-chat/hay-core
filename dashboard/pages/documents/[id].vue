<template>
  <Page :title="$t('documents.detail.documentPreview')">
    <template #header>
      <div class="flex items-center gap-3">
        <Button variant="ghost" @click="router.push('/documents')">
          <ArrowLeft class="h-4 w-4 mr-2" />
          {{ $t("documents.detail.backToDocuments") }}
        </Button>

        <template v-if="document">
          <Button
            v-if="document.sourceUrl && document.importMethod === 'web'"
            variant="outline"
            size="sm"
            :loading="recrawling"
            :disabled="recrawling"
            @click="recrawlFromSource"
          >
            <RefreshCw v-if="!recrawling" class="h-4 w-4 mr-2" />
            {{ $t("documents.actions.updateFromSource") }}
          </Button>
          <Button
            v-if="document.sourceUrl && document.importMethod === 'web'"
            variant="outline"
            size="sm"
            @click="visitSource"
          >
            <ExternalLink class="h-4 w-4 mr-2" />
            {{ $t("documents.detail.visitSource") }}
          </Button>
          <Button
            v-if="isEditorAuthored && !isEditing"
            variant="default"
            size="sm"
            @click="startEditContent"
          >
            <Pencil class="h-4 w-4 mr-2" />
            {{ $t("documents.detail.edit") }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive hover:text-destructive"
            :disabled="deleting"
            :loading="deleting"
            @click="showDeleteDialog = true"
          >
            <Trash2 v-if="!deleting" class="h-4 w-4 mr-2" />
            {{ $t("documents.actions.delete") }}
          </Button>
        </template>
      </div>
    </template>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <Loading :label="$t('documents.detail.loadingDocument')" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-12 w-12 text-red-500 mb-4" />
      <p class="text-lg font-medium text-foreground">{{ $t("documents.detail.failedToLoad") }}</p>
      <p class="text-sm text-neutral-muted mt-1">{{ error }}</p>
      <div class="flex gap-3 mt-6">
        <Button variant="outline" @click="router.push('/documents')">{{
          $t("documents.detail.backButton")
        }}</Button>
        <Button @click="fetchDocument">{{ $t("documents.detail.tryAgain") }}</Button>
      </div>
    </div>

    <!-- Document Content -->
    <template v-else-if="document">
      <!-- Document Title (editable) -->
      <div class="flex items-center gap-2">
        <template v-if="editingTitle">
          <input
            ref="titleInputRef"
            v-model="editTitleValue"
            class="bg-transparent border-b border-primary outline-none text-lg font-semibold w-full"
            @keydown.enter="saveTitle"
            @keydown.escape="cancelEditTitle"
            @blur="saveTitle"
          />
          <Button v-if="savingTitle" variant="ghost" size="sm" :loading="true" />
        </template>
        <span
          v-else
          class="text-lg font-semibold cursor-pointer hover:text-primary transition-colors group"
          :title="$t('documents.detail.clickToEditTitle')"
          @click="startEditTitle"
        >
          {{ document.title }}
          <Pencil
            class="inline h-3.5 w-3.5 ml-1 text-neutral-muted opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </span>
      </div>

      <!-- Last updated -->
      <span v-if="document.updatedAt" class="text-xs text-neutral-muted -mt-2">
        {{ $t("documents.detail.lastUpdated", { date: formatDateTime(document.updatedAt) }) }}
      </span>

      <!-- Description -->
      <p v-if="document.description" class="text-sm text-neutral-muted -mt-2">
        {{ document.description }}
      </p>

      <!-- Metadata -->
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <component :is="getFileIcon(document.type)" class="h-3 w-3 mr-1" />
          {{ document.type ? $t(`documents.filters.${document.type}`) : "DOC" }}
        </Badge>
        <Badge
          :variant="
            document.status === 'published'
              ? 'success'
              : document.status === 'processing'
                ? 'default'
                : document.status === 'error'
                  ? 'destructive'
                  : 'secondary'
          "
        >
          {{ $t(`documents.filters.${document.status}`) }}
        </Badge>
        <Badge v-if="document.visibility" variant="outline">
          {{ $t(`documents.import.metadata.${document.visibility}`) }}
        </Badge>
        <Badge v-if="document.sourceUrl" variant="outline" class="gap-1">
          <Globe class="h-3 w-3" />
          {{ $t("documents.detail.webImport") }}
        </Badge>
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-xs text-neutral-muted">{{ $t("documents.detail.statusLabel") }}</span>
          <Input
            v-model="selectedStatus"
            type="select"
            :options="statusOptions"
            class="w-36"
            :disabled="updatingStatus"
            @update:model-value="onStatusChange"
          />
        </div>
      </div>

      <!-- Source URL -->
      <div v-if="document.sourceUrl" class="text-sm">
        <span class="text-neutral-muted">{{ $t("documents.detail.source") }}</span>
        <a
          :href="document.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-1 text-primary hover:underline"
        >
          {{ document.sourceUrl }}
        </a>
      </div>

      <!-- Tags -->
      <div v-if="document.tags?.length" class="flex flex-wrap gap-1">
        <Badge v-for="tag in document.tags" :key="tag" variant="secondary" class="text-xs">
          {{ tag }}
        </Badge>
      </div>

      <!-- Editor (no surrounding card) -->
      <template v-if="isEditing">
        <DocumentTiptap ref="editorRef" :content="editorInitialContent" @update="onContentUpdate" />
        <div class="flex justify-end gap-2 mt-3">
          <Button variant="ghost" :disabled="savingContent" @click="cancelEditContent">
            {{ $t("documents.detail.cancel") }}
          </Button>
          <Button :loading="savingContent" :disabled="savingContent" @click="saveContent">
            {{ $t("documents.detail.save") }}
          </Button>
        </div>
      </template>

      <!-- Content Card -->
      <Card v-else>
        <CardContent class="pt-6">
          <div class="document-page-content">
            <div v-if="document.content" v-html="renderedContent" />
            <div v-else class="text-neutral-muted italic py-8 text-center">
              {{ $t("documents.detail.noContent") }}
            </div>
          </div>
        </CardContent>
      </Card>
    </template>

    <ConfirmDialog
      v-model:open="showDeleteDialog"
      :title="$t('documents.deleteDialog.title')"
      :description="$t('documents.deleteDialog.confirmSingle', { name: document?.title || '' })"
      :confirm-text="$t('documents.actions.delete')"
      :destructive="true"
      @confirm="confirmDelete"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import { HayApi } from "@/utils/api";
import { markdownToHtml } from "@/utils/markdownToHtml";
import { useToast } from "@/composables/useToast";
import type { JSONContent } from "@tiptap/vue-3";
import {
  ArrowLeft,
  FileText,
  FileCode,
  FileJson,
  File,
  AlertCircle,
  Globe,
  ExternalLink,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";

const { t } = useI18n();

interface DocumentDetail {
  id: string;
  title: string;
  description?: string;
  content?: string;
  contentJson?: Record<string, unknown> | null;
  type: string;
  status: string;
  visibility?: string;
  tags?: string[];
  categories?: string[];
  sourceUrl?: string;
  importMethod?: string;
  createdAt: string;
  updatedAt: string;
}

enum DocumentationStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

const router = useRouter();
const route = useRoute();

const toast = useToast();
const { formatDateTime } = useOrgDateTime();

const loading = ref(false);
const error = ref<string | null>(null);
const document = ref<DocumentDetail | null>(null);
const updatingStatus = ref(false);
const selectedStatus = ref<DocumentationStatus>(DocumentationStatus.DRAFT);

// Title editing
const editingTitle = ref(false);
const editTitleValue = ref("");
const savingTitle = ref(false);
const titleInputRef = ref<HTMLInputElement | null>(null);

const startEditTitle = () => {
  if (!document.value) return;
  editTitleValue.value = document.value.title;
  editingTitle.value = true;
  nextTick(() => {
    titleInputRef.value?.focus();
    titleInputRef.value?.select();
  });
};

const cancelEditTitle = () => {
  editingTitle.value = false;
};

const saveTitle = async () => {
  if (!document.value || savingTitle.value) return;

  const newTitle = editTitleValue.value.trim();
  if (!newTitle || newTitle === document.value.title) {
    editingTitle.value = false;
    return;
  }

  savingTitle.value = true;
  try {
    await HayApi.documents.update.mutate({
      id: document.value.id,
      title: newTitle,
    });
    document.value.title = newTitle;
    toast.success(t("documents.toast.titleUpdated"));
  } catch (err) {
    console.error("Failed to update title:", err);
    toast.error(t("documents.toast.titleUpdateFailed"));
  } finally {
    savingTitle.value = false;
    editingTitle.value = false;
  }
};

const documentId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
});

const isEditorAuthored = computed(() => document.value?.importMethod === "editor");
const statusOptions = computed(() => [
  { label: t("documents.filters.draft"), value: "draft" },
  { label: t("documents.filters.published"), value: "published" },
  { label: t("documents.filters.archived"), value: "archived" },
]);

const editorInitialContent = computed<JSONContent | undefined>(() => {
  const json = document.value?.contentJson;
  return json ? (json as JSONContent) : undefined;
});

const renderedContent = computed(() => {
  if (!document.value?.content) return "";
  if (isEditorAuthored.value) {
    return document.value.content;
  }
  return markdownToHtml(document.value.content);
});

const isEditing = ref(false);
const savingContent = ref(false);
const editorRef = ref<{
  getJSON: () => Record<string, unknown> | null;
  getHTML: () => string;
} | null>(null);
const editorJson = ref<Record<string, unknown> | null>(null);
const editorHtml = ref("");

const startEditContent = () => {
  if (!isEditorAuthored.value || !document.value) return;
  editorJson.value = (document.value.contentJson as Record<string, unknown>) || null;
  editorHtml.value = document.value.content || "";
  isEditing.value = true;
};

const cancelEditContent = () => {
  isEditing.value = false;
};

const onContentUpdate = (payload: { json: Record<string, unknown>; html: string }) => {
  editorJson.value = payload.json;
  editorHtml.value = payload.html;
};

const saveContent = async () => {
  if (!document.value || savingContent.value) return;
  savingContent.value = true;
  try {
    const json = editorJson.value || editorRef.value?.getJSON() || { type: "doc", content: [] };
    const html = editorHtml.value || editorRef.value?.getHTML() || "";
    await HayApi.documents.update.mutate({
      id: document.value.id,
      contentJson: json,
      contentHtml: html,
    });
    document.value.content = html;
    document.value.contentJson = json;
    isEditing.value = false;
    toast.success(t("documents.toast.contentUpdated"));
  } catch (err) {
    console.error("Failed to update document content:", err);
    toast.error(t("documents.toast.contentUpdateFailed"));
  } finally {
    savingContent.value = false;
  }
};

const getFileIcon = (type: string | undefined) => {
  switch (type) {
    case "pdf":
    case "doc":
    case "article":
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

const visitSource = () => {
  if (document.value?.sourceUrl) {
    window.open(document.value.sourceUrl, "_blank", "noopener,noreferrer");
  }
};

const recrawling = ref(false);
const deleting = ref(false);
const showDeleteDialog = ref(false);

const confirmDelete = async () => {
  if (!document.value || deleting.value) return;
  deleting.value = true;
  try {
    const result = await HayApi.documents.delete.mutate({ id: document.value.id });
    if (result.success) {
      toast.success(result.message || t("documents.toast.deleteSuccess"));
      router.push("/documents");
    }
  } catch (err) {
    console.error("Error deleting document:", err);
    toast.error(t("documents.toast.deleteFailed"));
  } finally {
    deleting.value = false;
    showDeleteDialog.value = false;
  }
};

const recrawlFromSource = async () => {
  if (!document.value || recrawling.value) return;
  recrawling.value = true;
  try {
    await HayApi.documents.recrawl.mutate({ documentId: document.value.id });
    toast.success(t("documents.toast.updateStarted", { name: document.value.title }));
  } catch (err) {
    console.error("Recrawl error:", err);
    toast.error(t("documents.toast.updateFailed"));
  } finally {
    recrawling.value = false;
  }
};

const onStatusChange = async (status: string | number | boolean) => {
  if (!document.value || updatingStatus.value || typeof status !== "string") return;
  if (status === document.value.status) return;

  updatingStatus.value = true;
  try {
    await HayApi.documents.update.mutate({
      id: document.value.id,
      status: status as DocumentationStatus,
    });
    document.value.status = status;
    selectedStatus.value = status as DocumentationStatus;
    toast.success(t("documents.toast.statusUpdated"));
  } catch (err) {
    console.error("Failed to update status:", err);
    selectedStatus.value =
      (document.value.status as DocumentationStatus) || DocumentationStatus.DRAFT;
    toast.error(t("documents.toast.statusUpdateFailed"));
  } finally {
    updatingStatus.value = false;
  }
};

const fetchDocument = async () => {
  if (!documentId.value) return;

  loading.value = true;
  error.value = null;

  try {
    const result = await HayApi.documents.getById.query({
      id: documentId.value,
    });
    document.value = result as DocumentDetail;
    selectedStatus.value = (result.status as DocumentationStatus) || DocumentationStatus.DRAFT;
  } catch (err) {
    console.error("Failed to fetch document:", err);
    error.value = err instanceof Error ? err.message : t("documents.detail.failedToLoad");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchDocument();
});

// SEO
useHead({
  title: computed(() =>
    document.value?.title
      ? t("documents.detail.seoTitle", { title: document.value.title })
      : t("documents.detail.seoTitleDefault"),
  ),
  meta: [
    {
      name: "description",
      content: computed(() => document.value?.description || t("documents.detail.seoDescription")),
    },
  ],
});
</script>

<style lang="scss">
.document-page-content {
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--foreground);

  h1,
  h2,
  h3,
  h4 {
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--foreground);
  }

  h1 {
    font-size: 1.5rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
  }

  h2 {
    font-size: 1.25rem;
  }

  h3 {
    font-size: 1.125rem;
  }

  h4 {
    font-size: 1rem;
  }

  p {
    margin-bottom: 1rem;
  }

  a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover {
      text-decoration: none;
    }
  }

  ul,
  ol {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
  }

  ul {
    list-style-type: disc;
  }

  ol {
    list-style-type: decimal;
  }

  li {
    margin-bottom: 0.25rem;
  }

  code {
    background-color: var(--background-tertiary);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  pre {
    background-color: var(--background-tertiary);
    padding: 1rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin-bottom: 1rem;

    code {
      background: none;
      padding: 0;
      font-size: 0.8125rem;
    }
  }

  blockquote {
    border-left: 3px solid var(--primary);
    padding-left: 1rem;
    margin-left: 0;
    margin-bottom: 1rem;
    color: var(--neutral-muted);
    font-style: italic;
  }

  hr {
    border: none;
    border-top: 1px solid var(--color-neutral-300);
    margin: 1.5rem 0;
  }

  strong {
    font-weight: 600;
  }

  em {
    font-style: italic;
  }

  del {
    text-decoration: line-through;
    opacity: 0.7;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
  }

  th,
  td {
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  th {
    background-color: var(--background-secondary);
    font-weight: 600;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
    margin: 0.5rem 0;
  }
}
</style>
