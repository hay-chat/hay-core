<template>
  <div class="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center mt-4 gap-2">
    <!-- Secondary actions (left side on desktop) -->
    <div v-if="$slots.secondary" class="flex flex-col-reverse sm:flex-row gap-2">
      <slot name="secondary" />
    </div>

    <!-- Primary actions (right side on desktop) -->
    <div class="flex flex-col-reverse sm:flex-row gap-2 sm:ml-auto">
      <slot name="primary">
        <!-- Default slot falls back to primary -->
        <slot />
      </slot>
    </div>
  </div>
</template>
