<template>
  <!-- Decorative: the name is always written next to it. -->
  <span class="hay-avatar" :class="`hay-avatar--${kind}`" aria-hidden="true">
    <img v-if="src && !failed" :src="src" alt="" @error="failed = true" />
    <svg v-else-if="kind === 'ai'" width="55%" height="55%" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z" />
    </svg>
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  kind: "ai" | "human";
  name?: string;
  src?: string | null;
}>();

const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);

const initial = computed(() => props.name?.trim().charAt(0).toUpperCase() ?? "");
</script>
