<template>
  <HeadlessDialogTitle class="text-base font-semibold leading-6 text-foreground">
    <slot />
  </HeadlessDialogTitle>
</template>

<script setup lang="ts">
import { DialogTitle as HeadlessDialogTitle } from "@headlessui/vue";
</script>
