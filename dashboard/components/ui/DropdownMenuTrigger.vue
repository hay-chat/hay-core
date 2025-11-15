<template>
  <MenuButton v-bind="$attrs" class="w-full">
    <slot class="w-full" />
  </MenuButton>
</template>

<script setup lang="ts">
import { MenuButton } from "@headlessui/vue";

defineProps<{
  asChild?: boolean;
}>();
</script>
