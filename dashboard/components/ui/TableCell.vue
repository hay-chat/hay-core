<template>
  <td class="table-cell">
    <slot />
  </td>
</template>

<style lang="scss">
.table-cell {
  @apply p-4 align-middle [&:has([role=checkbox])]:pr-0;
}
</style>
