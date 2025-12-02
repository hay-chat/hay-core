<template>
  <Sheet v-model:open="isOpen" side="right" size="xl">
    <SheetHeader @close="close">
      <SheetTitle>
        <div class="flex items-center gap-2">
          <component :is="getFileIcon(document?.type)" class="h-5 w-5 text-neutral-muted" />
          {{ document?.title || "Document Preview" }}
        </div>
      </SheetTitle>
      <SheetDescription v-if="document?.description">
        {{ document.description }}
      </SheetDescription>
    </SheetHeader>

    <SheetContent>
      <!-- Loading State -->
      <div v-if="loading" class="flex items-center justify-center h-64">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle class="h-12 w-12 text-red-500 mb-4" />
        <p class="text-lg font-medium text-foreground">Failed to load document</p>
        <p class="text-sm text-neutral-muted mt-1">{{ error }}</p>
        <Button variant="outline" class="mt-4" @click="fetchDocument">
          Try Again
        </Button>
      </div>

      <!-- Document Content -->
      <div v-else-if="document" class="space-y-4">
        <!-- Document Metadata -->
        <div class="flex flex-wrap gap-2 pb-4 border-b">
          <Badge variant="outline">
            {{ document.type?.toUpperCase() || "DOC" }}
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
            {{ document.status }}
          </Badge>
          <Badge v-if="document.sourceUrl" variant="outline" class="gap-1">
            <Globe class="h-3 w-3" />
            Web Import
          </Badge>
        </div>

        <!-- Source URL -->
        <div v-if="document.sourceUrl" class="text-sm">
          <span class="text-neutral-muted">Source:</span>
          <a
            :href="document.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="ml-1 text-primary hover:underline"
          >
            {{ document.sourceUrl }}
          </a>
        </div>

        <!-- Markdown Content -->
        <div class="document-preview-content prose prose-sm max-w-none">
          <div v-if="document.content" v-html="renderedContent" />
          <div v-else class="text-neutral-muted italic">
            No content available for this document.
          </div>
        </div>
      </div>
    </SheetContent>

    <SheetFooter>
      <Button variant="outline" @click="close">Close</Button>
    </SheetFooter>
  </Sheet>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { HayApi } from "@/utils/api";
import { markdownToHtml } from "@/utils/markdownToHtml";
import { FileText, FileCode, FileJson, File, AlertCircle, Globe } from "lucide-vue-next";

interface DocumentPreview {
  id: string;
  title: string;
  description?: string;
  content?: string;
  type: string;
  status: string;
  visibility?: string;
  tags?: string[];
  categories?: string[];
  sourceUrl?: string;
  importMethod?: string;
  createdAt: Date;
  updatedAt: Date;
}

const props = defineProps<{
  open: boolean;
  documentId: string | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const document = ref<DocumentPreview | null>(null);

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

const renderedContent = computed(() => {
  if (!document.value?.content) return "";
  return markdownToHtml(document.value.content);
});

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

const close = () => {
  isOpen.value = false;
};

const fetchDocument = async () => {
  if (!props.documentId) return;

  loading.value = true;
  error.value = null;

  try {
    const result = await HayApi.documents.getById.query({
      id: props.documentId,
    });
    document.value = result as DocumentPreview;
  } catch (err) {
    console.error("Failed to fetch document:", err);
    error.value = err instanceof Error ? err.message : "Failed to load document";
  } finally {
    loading.value = false;
  }
};

// Fetch document when opened or documentId changes
watch(
  () => [props.open, props.documentId],
  ([open, documentId]) => {
    if (open && documentId) {
      fetchDocument();
    } else if (!open) {
      // Reset state when closed
      document.value = null;
      error.value = null;
    }
  },
  { immediate: true }
);
</script>

<style lang="scss">
.document-preview-content {
  /* Base typography */
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--foreground);

  /* Headers */
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

  /* Paragraphs */
  p {
    margin-bottom: 1rem;
  }

  /* Links */
  a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover {
      text-decoration: none;
    }
  }

  /* Lists */
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

  /* Code */
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

  /* Blockquotes */
  blockquote {
    border-left: 3px solid var(--primary);
    padding-left: 1rem;
    margin-left: 0;
    margin-bottom: 1rem;
    color: var(--neutral-muted);
    font-style: italic;
  }

  /* Horizontal rule */
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.5rem 0;
  }

  /* Strong and emphasis */
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

  /* Tables */
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
}
</style>
