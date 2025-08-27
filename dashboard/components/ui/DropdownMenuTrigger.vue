<template>
  <MenuButton v-bind="$attrs">
    <slot />
  </MenuButton>
</template>

<script setup lang="ts">
import { MenuButton } from '@headlessui/vue';

defineProps<{
  asChild?: boolean;
}>();
</script>