<template>
  <input
    type="checkbox"
    :class="
      cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        $props.class
      )
    "
    :checked="checked"
    v-bind="$attrs"
    @input="
      $emit('update:checked', ($event.target as HTMLInputElement).checked)
    "
  />
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked?: boolean;
  class?: string;
}

const _props = withDefaults(defineProps<CheckboxProps>(), {
  checked: false,
  class: "",
});

const _emit = defineEmits<{
  "update:checked": [value: boolean];
}>();
</script>
