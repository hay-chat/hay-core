<template>
  <div class="space-y-3">
    <Input
      v-model="searchText"
      type="search"
      :label="$t('helpCenter.picker.search')"
      :placeholder="$t('helpCenter.picker.searchPlaceholder')"
      :icon-start="Search"
    />

    <div v-if="loading && documents.length === 0" class="space-y-2" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="h-10 animate-pulse rounded-md bg-neutral-100" />
    </div>

    <div v-else-if="failed" class="space-y-2 text-sm" role="alert">
      <p class="text-destructive">{{ $t("helpCenter.picker.loadFailed") }}</p>
      <Button variant="outline" size="sm" @click="load">{{ $t("helpCenter.tryAgain") }}</Button>
    </div>

    <p v-else-if="documents.length === 0" class="py-4 text-sm text-neutral-muted">
      {{ query ? $t("helpCenter.picker.noMatches") : $t("helpCenter.picker.noDocuments") }}
    </p>

    <ul v-else class="max-h-72 divide-y overflow-y-auto rounded-md border" :aria-busy="loading">
      <li v-for="doc in documents" :key="doc.id">
        <label
          class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-neutral-50"
          :class="{ 'cursor-default opacity-70': isFixed(doc.id) }"
        >
          <input
            type="checkbox"
            class="h-4 w-4 shrink-0 accent-primary"
            :checked="isFixed(doc.id) || modelValue.includes(doc.id)"
            :disabled="isFixed(doc.id)"
            @change="toggle(doc.id)"
          />
          <span class="min-w-0 flex-1 truncate text-sm">
            {{ doc.title || $t("helpCenter.untitled") }}
          </span>
          <Badge v-if="isFixed(doc.id)" variant="secondary">
            {{ $t("helpCenter.picker.alreadyHere") }}
          </Badge>
          <Badge v-else-if="placements?.[doc.id]" variant="outline">
            {{ $t("helpCenter.picker.inCollection", { collection: placements[doc.id] }) }}
          </Badge>
          <Badge v-if="doc.status !== 'published'" variant="warning">
            {{ $t("helpCenter.picker.notPublished") }}
          </Badge>
        </label>
      </li>
    </ul>

    <div v-if="totalPages > 1" class="flex items-center justify-between gap-2">
      <Button variant="outline" size="sm" :disabled="page <= 1 || loading" @click="goTo(page - 1)">
        {{ $t("helpCenter.picker.previous") }}
      </Button>
      <span class="text-sm text-neutral-muted" aria-live="polite">
        {{ $t("helpCenter.picker.pageOf", { page, total: totalPages }) }}
      </span>
      <Button
        variant="outline"
        size="sm"
        :disabled="page >= totalPages || loading"
        @click="goTo(page + 1)"
      >
        {{ $t("helpCenter.picker.next") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { refDebounced } from "@vueuse/core";
import { Search } from "lucide-vue-next";
import { Hay } from "@/utils/api";

interface PickerDocument {
  id: string;
  title: string;
  status: string;
}

const PAGE_SIZE = 10;

const props = defineProps<{
  /** Ids of the documents picked so far, in the order they were picked. */
  modelValue: string[];
  /** Documents already in the collection being edited: shown ticked and locked. */
  fixedIds?: string[];
  /** Title of the other collection each already-placed document is in, by document id. */
  placements?: Record<string, string>;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const documents = ref<PickerDocument[]>([]);
const loading = ref(true);
const failed = ref(false);
const page = ref(1);
const totalPages = ref(1);
const searchText = ref("");
const query = refDebounced(searchText, 300);
/** Only the answer to the latest request is shown. */
let latestRequest = 0;

const isFixed = (id: string) => props.fixedIds?.includes(id) ?? false;

function toggle(id: string) {
  emit(
    "update:modelValue",
    props.modelValue.includes(id)
      ? props.modelValue.filter((picked) => picked !== id)
      : [...props.modelValue, id],
  );
}

async function load() {
  const request = ++latestRequest;
  loading.value = true;
  failed.value = false;
  try {
    const text = query.value.trim();
    const result = await Hay.documents.list.query({
      pagination: { page: page.value, limit: PAGE_SIZE },
      sorting: { orderBy: "title", orderDirection: "asc" },
      ...(text && { search: { query: text, searchFields: ["title"] } }),
    });
    if (request !== latestRequest) return;
    documents.value = result.items.map((doc) => ({
      id: doc.id,
      title: doc.title ?? "",
      status: doc.status,
    }));
    totalPages.value = Math.max(1, result.pagination.totalPages);
  } catch (error) {
    if (request !== latestRequest) return;
    console.error("Failed to load documents:", error);
    failed.value = true;
  } finally {
    if (request === latestRequest) loading.value = false;
  }
}

function goTo(next: number) {
  page.value = next;
  void load();
}

watch(query, () => goTo(1));
onMounted(load);
</script>
