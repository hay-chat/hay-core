<template>
  <MenuItem v-slot="{ active }">
    <button
      :class="[
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors whitespace-nowrap',
        active ? 'bg-accent text-accent-foreground' : '',
        $attrs['class'],
      ]"
      v-bind="$attrs"
      @click="$emit('click')"
    >
      <slot />
    </button>
  </MenuItem>
</template>

<script setup lang="ts">
import { MenuItem } from "@headlessui/vue";

defineEmits<{
  click: [];
}>();
</script>
