<template>
  <div :class="['page', 'page-' + width]">
    <div v-if="title || description || $slots.header" class="page-header">
      <div class="page-header-start">
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-description">{{ description }}</p>
      </div>
      <div class="page-header-end">
        <slot name="header" />
      </div>
    </div>
    <div class="page-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    width?: "max" | "full";
  }>(),
  {
    title: "",
    description: "",
    width: "full",
  },
);
</script>

<style lang="postcss">
.page {
  @apply p-4 md:p-6 mx-auto;
}
.page-header {
  @apply flex mb-4 justify-between gap-4;
}

.page-content {
  @apply space-y-4;
}

.page-title {
  @apply text-2xl;
}

.page-description {
  @apply text-neutral-muted;
  text-wrap: balance;
}

.page-max {
  max-width: 60rem;
}
</style>
