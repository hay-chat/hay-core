<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <Label>Which documents should this playbook use?</Label>
      <p class="text-sm text-neutral-muted">
        Select documents to ground the playbook in your knowledge base. You can skip this step if no
        documents are needed.
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-12 rounded-lg bg-muted animate-pulse" />
    </div>

    <!-- Error state -->
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription> Failed to load documents. Please try again later. </AlertDescription>
    </Alert>

    <!-- No documents available -->
    <Alert
      v-else-if="allDocuments.length === 0 && suggestedDocuments.length === 0"
      variant="info"
      :icon="Info"
    >
      <AlertDescription>
        No documents found. You can continue without documents — the playbook will rely only on the
        instructions you provide.
      </AlertDescription>
    </Alert>

    <!-- Document lists -->
    <template v-else>
      <!-- Suggested documents -->
      <div v-if="suggestedDocuments.length > 0" class="space-y-2">
        <p class="text-sm font-medium text-foreground">Suggested for you</p>
        <p class="text-xs text-neutral-muted">Based on your playbook description</p>
        <div class="grid grid-cols-1 gap-2">
          <OptionCard
            v-for="doc in suggestedDocuments"
            :key="doc.id"
            :label="doc.title"
            :checked="isSelected(doc.id)"
            @click="toggleDocument(doc.id)"
          />
        </div>
      </div>

      <!-- Divider -->
      <Separator v-if="suggestedDocuments.length > 0 && filteredDocuments.length > 0" />

      <!-- All documents -->
      <div v-if="remainingDocuments.length > 0" class="space-y-2">
        <p class="text-sm font-medium text-foreground">All documents</p>
        <Input
          v-if="remainingDocuments.length > 5"
          v-model="searchQuery"
          type="search"
          placeholder="Filter documents..."
          :icon-start="Search"
        />
        <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
          <OptionCard
            v-for="doc in filteredDocuments"
            :key="doc.id"
            :label="doc.title || 'Untitled'"
            :checked="isSelected(doc.id)"
            @click="toggleDocument(doc.id)"
          />
        </div>
      </div>

      <!-- Selected count -->
      <p v-if="modelValue.length > 0" class="text-sm text-neutral-muted">
        {{ modelValue.length }} document{{ modelValue.length === 1 ? "" : "s" }} selected
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Info, Search } from "lucide-vue-next";
import { HayApi } from "@/utils/api";

interface DocumentItem {
  id: string;
  title: string;
  description?: string;
}

const props = defineProps<{
  modelValue: string[];
  purpose: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const loading = ref(false);
const error = ref(false);
const searchQuery = ref("");
const suggestedDocuments = ref<DocumentItem[]>([]);
const allDocuments = ref<DocumentItem[]>([]);

const suggestedIds = computed(() => new Set(suggestedDocuments.value.map((d) => d.id)));

const remainingDocuments = computed(() =>
  allDocuments.value.filter((d) => !suggestedIds.value.has(d.id)),
);

const filteredDocuments = computed(() => {
  if (!searchQuery.value.trim()) return remainingDocuments.value;
  const q = searchQuery.value.toLowerCase();
  return remainingDocuments.value.filter(
    (d) => d.title?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q),
  );
});

function isSelected(docId: string): boolean {
  return props.modelValue.includes(docId);
}

function toggleDocument(docId: string) {
  const idx = props.modelValue.indexOf(docId);
  if (idx >= 0) {
    const next = [...props.modelValue];
    next.splice(idx, 1);
    emit("update:modelValue", next);
  } else {
    emit("update:modelValue", [...props.modelValue, docId]);
  }
}

onMounted(async () => {
  loading.value = true;
  error.value = false;
  try {
    const [searchResults, listResults] = await Promise.all([
      props.purpose.trim()
        ? HayApi.documents.search.query({ query: props.purpose, limit: 5 })
        : Promise.resolve([]),
      HayApi.documents.list.query({}),
    ]);

    // Deduplicate search results by documentId
    const seenIds = new Set<string>();
    suggestedDocuments.value = searchResults
      .filter((r) => {
        const docId = r.documentId as string | undefined;
        if (!docId || seenIds.has(docId)) return false;
        seenIds.add(docId);
        return true;
      })
      .map((r) => ({
        id: r.documentId as string,
        title: r.title,
      }));

    allDocuments.value = listResults.items.map((d) => ({
      id: d.id,
      title: d.title || "Untitled",
      description: d.description,
    }));
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
