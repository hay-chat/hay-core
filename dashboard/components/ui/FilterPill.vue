<template>
  <!-- A rounded filter toggle: label plus an optional count. Group several in a role="group". -->
  <button
    type="button"
    :aria-pressed="pressed"
    :class="[
      'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8',
      pressed
        ? 'border-neutral-900 bg-neutral-900 text-white'
        : 'border-neutral-300 text-neutral-700 hover:bg-accent',
    ]"
  >
    <slot />
    <span v-if="count !== undefined" class="tabular-nums opacity-70">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Whether this filter is the active one. */
    pressed: boolean;
    count?: number;
  }>(),
  { count: undefined },
);
</script>
