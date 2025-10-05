<template>
  <label
    :class="
      cn(
        'relative rounded-lg border bg-background text-neutral shadow-sm flex p-1 items-center gap-3 cursor-pointer transition-colors',
        'hover:bg-gray-50',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        isChecked && 'border-primary border-2',
        $props.class,
      )
    "
  >
    <img v-if="image" :src="image" :alt="label" class="h-12 w-12 flex-shrink-0" />
    <p class="flex-1">{{ label }}</p>

    <input
      type="checkbox"
      class="sr-only"
      :checked="isChecked"
      v-bind="$attrs"
      @change="handleChange"
    />

    <div :class="cn('h-5 w-5 flex-shrink-0  flex items-center justify-center transition-all')">
      <svg
        v-if="isChecked"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4 text-primary"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  </label>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked?: boolean;
  modelValue?: boolean;
  image?: string;
  label?: string;
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
