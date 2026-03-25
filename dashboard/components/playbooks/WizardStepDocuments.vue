<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <Label>{{ $t("wizard.documents.label") }}</Label>
      <p class="text-sm text-neutral-muted">
        {{ $t("wizard.documents.helperText") }}
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-12 rounded-lg bg-muted animate-pulse" />
    </div>

    <!-- Error state -->
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription> {{ $t("wizard.documents.errorLoad") }} </AlertDescription>
    </Alert>

    <!-- No documents available -->
    <Alert
      v-else-if="allDocuments.length === 0 && suggestedDocuments.length === 0"
      variant="info"
      :icon="Info"
    >
      <AlertDescription>
        {{ $t("wizard.documents.noDocuments") }}
      </AlertDescription>
    </Alert>

    <!-- Document lists -->
    <template v-else>
      <!-- Suggested documents -->
      <div v-if="suggestedDocuments.length > 0" class="space-y-2">
        <p class="text-sm font-medium text-foreground">{{ $t("wizard.documents.suggestedTitle") }}</p>
        <p class="text-xs text-neutral-muted">{{ $t("wizard.documents.suggestedHint") }}</p>
        <div class="grid grid-cols-1 gap-2">
          <div v-for="doc in suggestedDocuments" :key="doc.id" class="flex items-center gap-1">
            <OptionCard
              class="flex-1"
              :label="doc.title"
              :checked="isSelected(doc.id)"
              @click="toggleDocument(doc.id)"
            />
            <Button variant="ghost" size="icon-sm" @click="openPreview(doc.id)">
              <Eye class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Divider -->
      <Separator v-if="suggestedDocuments.length > 0 && filteredDocuments.length > 0" />

      <!-- All documents -->
      <div v-if="remainingDocuments.length > 0" class="space-y-2">
        <p class="text-sm font-medium text-foreground">{{ $t("wizard.documents.allDocumentsTitle") }}</p>
        <Input
          v-if="remainingDocuments.length > 5"
          v-model="searchQuery"
          type="search"
          :placeholder="$t('wizard.documents.filterPlaceholder')"
          :icon-start="Search"
        />
        <div class="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
          <div v-for="doc in filteredDocuments" :key="doc.id" class="flex items-center gap-1">
            <OptionCard
              class="flex-1"
              :label="doc.title || 'Untitled'"
              :checked="isSelected(doc.id)"
              @click="toggleDocument(doc.id)"
            />
            <Button variant="ghost" size="icon-sm" @click="openPreview(doc.id)">
              <Eye class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- Selected count -->
      <p v-if="modelValue.length > 0" class="text-sm text-neutral-muted">
        {{ modelValue.length }} document{{ modelValue.length === 1 ? "" : "s" }} selected
      </p>
    </template>

    <!-- Document Preview Sheet -->
    <DocumentPreviewSheet v-model:open="showPreview" :document-id="previewDocumentId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Info, Search, Eye } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import DocumentPreviewSheet from "@/components/documents/DocumentPreviewSheet.vue";

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
const showPreview = ref(false);
const previewDocumentId = ref<string | null>(null);

function openPreview(docId: string) {
  previewDocumentId.value = docId;
  showPreview.value = true;
}
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

    // Search results are already document-level (no duplicates)
    suggestedDocuments.value = searchResults.map((r) => ({
      id: r.id,
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
