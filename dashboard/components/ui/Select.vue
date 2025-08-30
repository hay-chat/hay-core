<template>
  <select
    :value="modelValue"
    @change="handleChange"
    :class="cn(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      props.class
    )"
    v-bind="$attrs"
  >
    <slot />
  </select>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface SelectProps {
  modelValue?: string | number;
  class?: string;
}

const props = defineProps<SelectProps>();

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
}>();

const handleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const value = isNaN(Number(target.value)) ? target.value : Number(target.value);
  emit('update:modelValue', value);
};
</script>