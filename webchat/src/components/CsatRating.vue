<template>
  <div class="hay-csat">
    <template v-if="!submitted">
      <p :id="questionId" class="hay-csat__question">{{ question }}</p>
      <div class="hay-csat__scale" role="group" :aria-labelledby="questionId">
        <button
          v-for="face in FACES"
          :key="face.value"
          type="button"
          class="hay-csat__option"
          :class="{ 'hay-csat__option--selected': selected === face.value }"
          :aria-label="t(face.label)"
          :aria-pressed="selected === face.value"
          :disabled="isSubmitting"
          @click="select(face.value)"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9.5" />
            <path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6" />
            <path :d="face.mouth" />
          </svg>
        </button>
      </div>
    </template>
    <p v-else class="hay-csat__thanks" role="status">{{ t("csat.thankYou") }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n, type TranslationKey } from "@/i18n";

const t = useI18n();

const props = defineProps<{
  question: string;
  submitted: boolean;
  submit: (rating: number) => Promise<boolean>;
}>();

const questionId = `hay-csat-${Math.random().toString(36).slice(2, 8)}`;

// 1 (very bad) to 5 (great): the same face, only the mouth changes.
const FACES: { value: number; label: TranslationKey; mouth: string }[] = [
  { value: 1, label: "csat.veryBad", mouth: "M8 16.6c1.1-1.5 2.4-2.2 4-2.2s2.9.7 4 2.2" },
  { value: 2, label: "csat.bad", mouth: "M8.6 16c.9-.8 2.1-1.2 3.4-1.2s2.5.4 3.4 1.2" },
  { value: 3, label: "csat.okay", mouth: "M8.6 15.2h6.8" },
  { value: 4, label: "csat.good", mouth: "M8.6 14.4c.9.8 2.1 1.2 3.4 1.2s2.5-.4 3.4-1.2" },
  { value: 5, label: "csat.great", mouth: "M8 13.8c1.1 1.7 2.4 2.5 4 2.5s2.9-.8 4-2.5" },
];

const selected = ref<number | null>(null);
const isSubmitting = ref(false);

const select = async (value: number) => {
  if (isSubmitting.value) return;
  selected.value = value;
  isSubmitting.value = true;
  // On success `submitted` flips to the thank-you state; on failure the
  // shopper can pick again.
  if (!(await props.submit(value))) selected.value = null;
  isSubmitting.value = false;
};
</script>

<style>
.hay-csat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.hay-csat__question,
.hay-csat__thanks {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--hay-text);
}

.hay-csat__scale {
  display: flex;
  gap: 6px;
}

.hay-csat__option {
  width: 44px;
  height: 44px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  border: 1px solid var(--hay-line);
  background: var(--hay-surface);
  color: var(--hay-meta);
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.hay-csat__option:hover:not(:disabled),
.hay-csat__option--selected {
  color: var(--hay-accent);
  border-color: var(--hay-accent);
  background: color-mix(in srgb, var(--hay-accent) 12%, var(--hay-surface));
}

.hay-csat__option:disabled {
  cursor: default;
}
</style>
