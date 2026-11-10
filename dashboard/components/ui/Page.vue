<template>
  <component
    :is="disabled === undefined ? 'div' : 'fieldset'"
    :class="['page', 'page-' + width]"
    :disabled="disabled"
  >
    <div v-if="title || description || $slots.header || $slots.title" class="page-header">
      <div class="page-header-start">
        <h1 class="page-title">
          <slot name="title">{{ title }}</slot>
        </h1>
        <p class="page-description">{{ description }}</p>
      </div>
      <div class="page-header-end">
        <slot name="header" />
      </div>
    </div>
    <div class="page-content">
      <slot />
    </div>
  </component>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    width?: "max" | "full";
    /**
     * Pass it (even as false) to render the page as a fieldset, so one flag natively disables
     * every control inside, header actions included. Omit it to keep a plain div.
     */
    disabled?: boolean;
  }>(),
  {
    title: "",
    description: "",
    width: "full",
    disabled: undefined,
  },
);
</script>

<style lang="postcss">
.page {
  @apply p-4 md:p-6 mx-auto min-w-0;
}
.page-header {
  @apply flex flex-col mb-4 gap-3 sm:flex-row sm:justify-between sm:gap-4;
}
.page-header-end {
  @apply flex flex-wrap items-center gap-2;
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
