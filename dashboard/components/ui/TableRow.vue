<template>
  <tr class="table-row">
    <slot />
  </tr>
</template>

<style lang="scss">
:not(.table-header) > .table-row {
  @apply hover:bg-background-secondary;
}
.table-row {
  @apply border-b transition-colors;

  &[data-state="selected"] {
    @apply bg-background-tertiary;
  }
}

.table-row:last-child {
  @apply border-b-0;
}
</style>
