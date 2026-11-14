<template>
  <div class="hay-answer">
    <div class="hay-answer__row">
      <button
        v-if="sources.length"
        type="button"
        class="hay-answer__sources"
        :aria-expanded="open"
        :aria-controls="listId"
        @click="open = !open"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        {{ sourcesLabel }}
      </button>
      <span v-if="rateable" class="hay-answer__rate" role="group" :aria-label="t('answer.rate')">
        <template v-for="option in OPTIONS" :key="option.value">
          <button
            v-if="!rating || rating === option.value"
            type="button"
            class="hay-answer__thumb"
            :class="{ 'hay-answer__thumb--chosen': rating === option.value }"
            :aria-label="t(option.label)"
            :aria-pressed="rating === option.value"
            @click="$emit('rate', option.value)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              :fill="rating === option.value ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="option.icon" />
            </svg>
          </button>
        </template>
      </span>
    </div>
    <ul v-if="sources.length && open" :id="listId" class="hay-answer__links">
      <li v-for="source in sources" :key="source.url">
        <a :href="source.url" target="_blank" rel="noopener">{{ source.title }}</a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n, type TranslationKey } from "@/i18n";
import type { AnswerSource } from "@/types";
import css from "./AnswerExtras.css?inline";

// Vite puts every <style> block into the one stylesheet inlined in the chat
// chunk (vite.config.ts); this component loads on demand, so it brings its own.
if (!document.getElementById("hay-answer-css")) {
  const style = document.createElement("style");
  style.id = "hay-answer-css";
  style.textContent = css;
  document.head.appendChild(style);
}

const t = useI18n();

const props = defineProps<{
  /** The pages the answer used (already checked to be http(s) links). */
  sources: AnswerSource[];
  /** Thumbs show only on the latest AI answer. */
  rateable: boolean;
  rating?: "up" | "down" | null;
}>();

defineEmits<{ rate: [rating: "up" | "down"] }>();

const OPTIONS: { value: "up" | "down"; label: TranslationKey; icon: string }[] = [
  {
    value: "up",
    label: "answer.helpful",
    icon: "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
  },
  {
    value: "down",
    label: "answer.notHelpful",
    icon: "M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",
  },
];

const open = ref(false);
const listId = `hay-sources-${Math.random().toString(36).slice(2, 8)}`;

const sourcesLabel = computed(() =>
  props.sources.length === 1
    ? t("answer.source")
    : t("answer.sources").replace("{n}", String(props.sources.length)),
);
</script>
