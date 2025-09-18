<template>
  <div class="flex flex-col space-y-1.5 p-6 card-header">
    <slot />
  </div>
</template>

<style lang="scss">
.card-header + .card-content {
  @apply pt-0;
}
</style>
