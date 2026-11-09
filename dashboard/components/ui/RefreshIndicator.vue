<template>
  <span
    role="status"
    class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-neutral-muted transition-opacity duration-200"
    :class="active ? 'opacity-100 delay-200' : 'opacity-0'"
    data-testid="refresh-indicator"
  >
    <Loader2
      v-if="active"
      class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
    <span v-if="active" class="sr-only">{{ $t("common.updating") }}</span>
  </span>
</template>

<script setup lang="ts">
import { Loader2 } from "lucide-vue-next";

// Always rendered at a fixed size, so appearing cannot shift the header. The
// transition delay keeps a fast revalidation from flickering it.
defineProps<{ active: boolean }>();
</script>
