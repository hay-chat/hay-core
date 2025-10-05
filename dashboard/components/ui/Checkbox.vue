<template>
  <div class="relative inline-flex items-center">
    <input
      type="checkbox"
      :class="
        cn(
          'peer h-4 w-4 shrink-0 rounded-sm border appearance-none cursor-pointer',
          'border-input bg-background',
          'checked:bg-primary checked:border-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          $props.class,
        )
      "
      :checked="isChecked"
      :data-state="isChecked ? 'checked' : 'unchecked'"
      v-bind="$attrs"
      @change="handleChange"
    />
    <svg
      v-if="isChecked"
      class="absolute pointer-events-none h-3 w-3 text-primary-foreground"
      :class="['left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2']"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked?: boolean;
  modelValue?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<CheckboxProps>(), {
  checked: undefined,
  modelValue: undefined,
  class: "",
});

const emit = defineEmits<{
  "update:checked": [value: boolean];
  "update:modelValue": [value: boolean];
}>();

// Support both v-model and :checked patterns
const isChecked = computed(() => {
  // If modelValue is provided (v-model), use it
  if (props.modelValue !== undefined) {
    return props.modelValue;
  }
  // Otherwise, use checked prop
  return props.checked ?? false;
});

const handleChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const newValue = target.checked;

  // Emit for v-model
  emit("update:modelValue", newValue);
  // Emit for :checked pattern
  emit("update:checked", newValue);
};
</script>
