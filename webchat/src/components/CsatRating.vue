<template>
  <div class="hay-csat">
    <template v-if="!submitted">
      <p class="hay-csat__question">{{ question }}</p>
      <div class="hay-csat__scale" role="group" :aria-label="question">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          class="hay-csat__option"
          :class="{ 'hay-csat__option--selected': selected === option.value }"
          :aria-label="String(option.value)"
          :disabled="isSubmitting"
          @click="select(option.value)"
        >
          <span class="hay-csat__emoji">{{ option.emoji }}</span>
        </button>
      </div>
    </template>
    <p v-else class="hay-csat__thanks">{{ t("csat.thankYou") }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "@/i18n";

const t = useI18n();

defineProps<{
  question: string;
  submitted: boolean;
}>();

const emit = defineEmits<{
  submit: [rating: number];
}>();

// 1 (very unhappy) to 5 (very happy)
const options = [
  { value: 1, emoji: "😠" },
  { value: 2, emoji: "🙁" },
  { value: 3, emoji: "😐" },
  { value: 4, emoji: "🙂" },
  { value: 5, emoji: "😀" },
];

const selected = ref<number | null>(null);
const isSubmitting = ref(false);

const select = (value: number) => {
  if (isSubmitting.value) return;
  selected.value = value;
  isSubmitting.value = true;
  emit("submit", value);
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

.hay-csat__question {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-neutral-700);
}

.hay-csat__scale {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.hay-csat__option {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: 50%;
  line-height: 1;
  opacity: 0.65;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.hay-csat__option:hover:not(:disabled) {
  transform: scale(1.2);
  opacity: 1;
}

.hay-csat__option--selected {
  opacity: 1;
  transform: scale(1.2);
}

.hay-csat__option:disabled {
  cursor: default;
}

.hay-csat__emoji {
  font-size: 26px;
}

.hay-csat__thanks {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-neutral-700);
}
</style>
