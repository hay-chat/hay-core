<template>
  <Menu as="div" class="relative inline-flex text-left w-full">
    <slot />
  </Menu>
</template>

<script setup lang="ts">
import { Menu } from "@headlessui/vue";
</script>
