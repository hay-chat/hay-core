<template>
  <div class="flex items-start justify-between px-4 py-4 sm:px-6 border-b">
    <div class="flex-1 min-w-0">
      <slot />
    </div>
    <div class="ml-3 flex h-7 items-center">
      <button
        type="button"
        class="rounded-md text-neutral-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        @click="$emit('close')"
      >
        <span class="sr-only">Close panel</span>
        <X class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";

defineEmits<{
  close: [];
}>();
</script>
