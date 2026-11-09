<template>
  <div class="grid gap-2" data-testid="setup-document-search">
    <Input
      :id="inputId"
      :model-value="query"
      type="search"
      :icon-start="Search"
      :label="$t('setup.panel.searchLabel')"
      autocomplete="off"
      class="max-md:min-h-11"
      @update:model-value="onInput"
    />

    <p v-if="state === 'idle'" class="text-sm text-neutral-muted">
      {{ $t("setup.panel.searchHint") }}
    </p>
    <p v-else-if="state === 'searching'" class="text-sm text-neutral-muted" role="status">
      {{ $t("setup.panel.searching") }}
    </p>
    <p v-else-if="state === 'error'" class="text-sm text-destructive" role="alert">
      {{ $t("setup.panel.searchError") }}
    </p>
    <p v-else-if="results.length === 0" class="text-sm text-neutral-muted" role="status">
      {{ $t("setup.panel.noResults", { query: searched }) }}
    </p>
    <ul v-else class="grid" :aria-label="$t('setup.panel.resultsLabel')">
      <li v-for="doc in results" :key="doc.id">
        <button
          type="button"
          class="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm text-neutral-900 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
          @click="emit('select', doc)"
        >
          {{ pageTitle(doc.title) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Search } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { pageTitle } from "@/utils/format";
import type { SetupDocumentRef } from "@/stores/setup";

const props = defineProps<{
  /** The row's own answer document, which is never offered as a source for itself. */
  excludeId?: string;
}>();

const emit = defineEmits<{
  select: [document: SetupDocumentRef];
}>();

const MIN_CHARS = 2;
const MAX_RESULTS = 5;
const DEBOUNCE_MS = 300;

type SearchState = "idle" | "searching" | "results" | "error";

const inputId = `setup-doc-search-${Math.random().toString(36).slice(2, 8)}`;
const query = ref("");
const searched = ref("");
const state = ref<SearchState>("idle");
const results = ref<SetupDocumentRef[]>([]);

let timer: ReturnType<typeof setTimeout> | null = null;
let latest = 0;

const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

const search = async (text: string) => {
  const mine = ++latest;
  try {
    // One extra, so hiding the row's own answer still leaves a full list.
    const found = await Hay.documents.search.query({ query: text, limit: MAX_RESULTS + 1 });
    if (mine !== latest) return;
    results.value = found
      .filter((doc) => doc.id !== props.excludeId)
      .slice(0, MAX_RESULTS)
      .map(({ id, title }) => ({ id, title }));
    searched.value = text;
    state.value = "results";
  } catch {
    if (mine === latest) state.value = "error";
  }
};

const onInput = (value: string | number | boolean) => {
  query.value = String(value);
  clearTimer();
  latest++;
  const text = query.value.trim();
  if (text.length < MIN_CHARS) {
    state.value = "idle";
    results.value = [];
    return;
  }
  state.value = "searching";
  timer = setTimeout(() => void search(text), DEBOUNCE_MS);
};

const focus = () => document.getElementById(inputId)?.focus();
defineExpose({ focus });

onBeforeUnmount(clearTimer);
</script>
