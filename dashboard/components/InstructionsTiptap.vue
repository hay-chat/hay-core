<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label :for="editorId" class="text-sm font-medium">
        {{ label }}
      </label>
      <div class="text-xs text-neutral-muted">
        <kbd class="px-1.5 py-0.5 text-xs bg-background-tertiary rounded">@</kbd>
        for Actions/Documents •
        <kbd class="px-1.5 py-0.5 text-xs bg-background-tertiary rounded">/</kbd>
        for blocks •
        <kbd class="px-1.5 py-0.5 text-xs bg-background-tertiary rounded">Cmd+Z</kbd>
        to undo
      </div>
    </div>
    <div
      :id="editorId"
      class="instructions-editor-container"
      :class="{ 'instructions-editor-error': error }"
    >
      <BaseTiptap
        v-if="!loading"
        ref="editorRef"
        :content="editorContent"
        :placeholder="'Type / for commands or @ for actions and documents...'"
        :extensions="editorExtensions"
        @update="handleUpdate"
      />
      <div v-else class="flex items-center justify-center py-12">
        <Loading />
      </div>
    </div>
    <p v-if="error" class="text-sm text-red-500">
      {{ error }}
    </p>
    <p v-if="hint" class="text-sm text-neutral-muted">
      {{ hint }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { JSONContent } from "@tiptap/vue-3";
import BaseTiptap from "@/components/BaseTiptap.vue";
import { configureMentionExtension } from "@/components/tiptap/MentionExtension";
import { configureSlashCommand } from "@/components/tiptap/SlashCommand";
import type { MCPTool, DocumentItem } from "@/components/tiptap/MentionExtension";
import { HayApi } from "@/utils/api";

interface Props {
  initialData?: JSONContent;
  label?: string;
  hint?: string;
  error?: string;
  disableApi?: boolean;
  mockDocuments?: DocumentItem[];
  mockTools?: MCPTool[];
}

const props = withDefaults(defineProps<Props>(), {
  label: "Instructions",
  disableApi: false,
});

const editorId = `editor-${Math.random().toString(36).substring(2, 11)}`;
const editorRef = ref<InstanceType<typeof BaseTiptap> | null>(null);
const mcpTools = ref<MCPTool[]>([]);
const documents = ref<DocumentItem[]>([]);
const loading = ref(true);
const currentContent = ref<JSONContent | undefined>(undefined);

// Fetch MCP tools from the API
const fetchMCPTools = async () => {
  if (props.disableApi) {
    mcpTools.value = props.mockTools || [];
    return;
  }

  try {
    const tools = await HayApi.plugins.getMCPTools.query();
    mcpTools.value = tools;
  } catch (error) {
    console.error("Failed to fetch MCP tools:", error);
    mcpTools.value = [];
  }
};

// Fetch documents from the API
const fetchDocuments = async () => {
  if (props.disableApi) {
    documents.value = props.mockDocuments || [];
    return;
  }

  try {
    const result = await HayApi.documents.list.query({
      pagination: { page: 1, limit: 100 },
    });

    documents.value = (result.items || [])
      .map((doc: Partial<DocumentItem>) => ({
        id: doc.id || "",
        name: doc.name || doc.title || "Untitled Document",
        type: doc.type || "document",
        url: doc.url || "",
      }))
      .filter((doc) => doc.id && doc.name);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    documents.value = [];
  }
};

// Ensure we always provide valid Tiptap data
const editorContent = computed(() => {
  if (props.initialData && typeof props.initialData === "object") {
    return props.initialData;
  }

  return {
    type: "doc",
    content: [],
  };
});

// Tiptap extensions
const editorExtensions = computed(() => [
  configureMentionExtension({
    mcpTools: mcpTools.value,
    documents: documents.value,
  }),
  configureSlashCommand({
    mcpTools: mcpTools.value,
    documents: documents.value,
  }),
]);

const handleUpdate = (content: JSONContent) => {
  currentContent.value = content;
};

// Initialize
onMounted(async () => {
  await Promise.all([fetchMCPTools(), fetchDocuments()]);
  loading.value = false;
});

// Expose methods
defineExpose({
  save: () => {
    return currentContent.value || editorRef.value?.getJSON() || null;
  },
  clear: () => {
    if (editorRef.value) {
      editorRef.value.clear();
    }
  },
  getJSON: () => {
    return currentContent.value || editorRef.value?.getJSON() || null;
  },
});
</script>

<style>
/* Instructions editor container styles */
.instructions-editor-container {
  min-height: 200px;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  background-color: var(--color-background);
  padding: 1rem;
  font-size: var(--font-size-input);
}

.instructions-editor-container:focus-within {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.instructions-editor-error {
  border-color: rgb(239, 68, 68);
}

kbd {
  background-color: var(--color-muted);
  border: 1px solid var(--color-border);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
}

/* Mention Styles - Rendered inline */
.mention {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem 0.125rem 0.1875rem;
  margin: 0 0.125rem;
  border-radius: 0.25rem;
  font-size: var(--font-size-input);
  cursor: default;
  user-select: none;
  vertical-align: middle;
  font-weight: 500;
}

.mention-thumbnail {
  width: 1rem;
  height: 1rem;
  object-fit: contain;
  border-radius: 0.125rem;
  display: inline-block;
  vertical-align: middle;
}

.mention-icon {
  width: 1rem;
  height: 1rem;
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

.mention-icon-document {
  background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNiMjYxMDUiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1ib29rLWljb24gbHVjaWRlLWJvb2siPjxwYXRoIGQ9Ik00IDE5LjV2LTE1QTIuNSAyLjUgMCAwIDEgNi41IDJIMTlhMSAxIDAgMCAxIDEgMXYxOGExIDEgMCAwIDEtMSAxSDYuNWExIDEgMCAwIDEgMC01SDIwIi8+PC9zdmc+");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

/* Action mentions */
.mention.mention-action {
  background: var(--color-purple-100);
  border: 1px solid var(--color-purple-300);
  color: var(--color-purple-600);
}

.mention.mention-action:hover {
  background: var(--color-purple-200);
  border-color: var(--color-purple-400);
}

/* Document mentions */
.mention.mention-document {
  background: var(--color-document-100);
  border: 1px solid var(--color-document-300);
  color: var(--color-document-600);
}

.mention-document-label {
  max-width: 30ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

.mention.mention-document:hover {
  background: var(--color-document-200);
  border-color: var(--color-document-400);
}

/* Mention & Slash Command Menu */
.mention-menu,
.slash-command-menu {
  min-width: 360px;
  max-width: 520px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.625rem;
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.15),
    0 8px 16px rgba(0, 0, 0, 0.1);
  padding: 0.375rem;
  display: block;
}

.mention-item,
.slash-command-item {
  display: flex;
  align-items: center;
  padding: 0.375rem 0.5rem;
  cursor: pointer;
  border-radius: 0.375rem;
  transition: all 0.15s ease;
  margin-bottom: 0.125rem;
  gap: 0.5rem;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  scroll-margin: 0.375rem;
}

.mention-item:last-child,
.slash-command-item:last-child {
  margin-bottom: 0;
}

.mention-item:hover,
.mention-item.active,
.slash-command-item:hover,
.slash-command-item.active {
  background: var(--color-muted);
}

.mention-item-content,
.slash-command-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.3;
}

.mention-item-name,
.slash-command-title {
  font-weight: 500;
  color: var(--color-foreground);
  font-size: var(--font-size-input);
  margin-bottom: 0.125rem;
}

.mention-item-meta,
.slash-command-description {
  font-size: var(--font-size-input);
  color: var(--color-neutral-muted);
}

.mention-item-icon,
.slash-command-icon {
  font-size: 1.25rem;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mention-plugin-thumbnail {
  width: 1.5rem;
  height: 1.5rem;
  object-fit: contain;
  border-radius: 0.25rem;
}

.slash-command-thumbnail {
  width: 1.5rem;
  height: 1.5rem;
  object-fit: contain;
  border-radius: 0.25rem;
}

/* Action and Document themed menu items */
.mention-item-action.active,
.mention-item-action:hover {
  background: var(--color-action-100);
}

.mention-item-document.active,
.mention-item-document:hover {
  background: var(--color-document-100);
}

/* No results message styling */
.mention-item.mention-no-results,
.slash-command-item.slash-command-no-results {
  cursor: default;
  pointer-events: none;
  opacity: 0.7;
}

.mention-no-results .mention-item-icon,
.slash-command-no-results .slash-command-icon {
  font-size: var(--font-size-input);
  color: var(--color-neutral-muted);
}

.mention-no-results .mention-item-name,
.mention-no-results .mention-item-meta,
.slash-command-no-results .slash-command-title,
.slash-command-no-results .slash-command-description {
  color: var(--color-neutral-muted);
}

.mention-no-results .mention-item-name,
.slash-command-no-results .slash-command-title {
  font-style: italic;
}
</style>
