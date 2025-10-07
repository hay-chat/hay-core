<template>
  <th class="table-h">
    <slot />
  </th>
</template>

<style lang="scss">
.table-h {
  @apply h-12 px-4 text-left align-middle font-medium text-neutral-muted [&:has([role=checkbox])]:pr-0 border-b;
}
</style>
