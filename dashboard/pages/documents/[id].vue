<template>
  <Page :title="document?.title || 'Document Preview'" :description="document?.description || ''">
    <template #header>
      <div class="flex items-center gap-3">
        <Button variant="ghost" @click="router.push('/documents')">
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back to Documents
        </Button>

        <template v-if="document">
          <Button
            v-if="document.sourceUrl && document.importMethod === 'web'"
            variant="outline"
            size="sm"
            @click="visitSource"
          >
            <ExternalLink class="h-4 w-4 mr-2" />
            Visit Source
          </Button>
        </template>
      </div>
    </template>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <Loading label="Loading document..." />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-12 w-12 text-red-500 mb-4" />
      <p class="text-lg font-medium text-foreground">Failed to load document</p>
      <p class="text-sm text-neutral-muted mt-1">{{ error }}</p>
      <div class="flex gap-3 mt-6">
        <Button variant="outline" @click="router.push('/documents')">Back to Documents</Button>
        <Button @click="fetchDocument">Try Again</Button>
      </div>
    </div>

    <!-- Document Content -->
    <template v-else-if="document">
      <!-- Metadata -->
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          <component :is="getFileIcon(document.type)" class="h-3 w-3 mr-1" />
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
        <Badge v-if="document.visibility" variant="outline">
          {{ document.visibility }}
        </Badge>
        <Badge v-if="document.sourceUrl" variant="outline" class="gap-1">
          <Globe class="h-3 w-3" />
          Web Import
        </Badge>

        <span v-if="document.updatedAt" class="text-xs text-neutral-muted ml-auto">
          Last updated {{ formatDate(document.updatedAt) }}
        </span>
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

      <!-- Tags -->
      <div v-if="document.tags?.length" class="flex flex-wrap gap-1">
        <Badge v-for="tag in document.tags" :key="tag" variant="secondary" class="text-xs">
          {{ tag }}
        </Badge>
      </div>

      <!-- Content Card -->
      <Card>
        <CardContent class="pt-6">
          <div class="document-page-content">
            <div v-if="document.content" v-html="renderedContent" />
            <div v-else class="text-neutral-muted italic py-8 text-center">
              No content available for this document.
            </div>
          </div>
        </CardContent>
      </Card>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { HayApi } from "@/utils/api";
import { markdownToHtml } from "@/utils/markdownToHtml";
import {
  ArrowLeft,
  FileText,
  FileCode,
  FileJson,
  File,
  AlertCircle,
  Globe,
  ExternalLink,
} from "lucide-vue-next";

interface DocumentDetail {
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
  createdAt: string;
  updatedAt: string;
}

const router = useRouter();
const route = useRoute();

const loading = ref(false);
const error = ref<string | null>(null);
const document = ref<DocumentDetail | null>(null);

const documentId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] : id;
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

const formatDate = (date: string) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

const visitSource = () => {
  if (document.value?.sourceUrl) {
    window.open(document.value.sourceUrl, "_blank", "noopener,noreferrer");
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
  } catch (err) {
    console.error("Failed to fetch document:", err);
    error.value = err instanceof Error ? err.message : "Failed to load document";
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
      ? `${document.value.title} - Documents - Hay Dashboard`
      : "Document - Hay Dashboard",
  ),
  meta: [
    {
      name: "description",
      content: computed(() => document.value?.description || "View document details"),
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
