<template>
  <div
    :class="[
      'flex flex-col space-y-1.5 p-6 card-header',
      variant === 'accordion' && 'cursor-pointer hover:bg-muted/50 transition-colors',
    ]"
    @click="handleClick"
  >
    <div class="flex items-center justify-between">
      <div class="flex-1">
        <slot />
      </div>
      <ChevronDown
        v-if="variant === 'accordion'"
        :class="['w-5 h-5 transition-transform duration-200', isOpen && 'rotate-180']"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, type Ref } from "vue";
import { ChevronDown } from "lucide-vue-next";

const variant = inject<"default" | "accordion">("cardVariant", "default");
const isOpen = inject<Ref<boolean>>("cardIsOpen");
const toggle = inject<() => void>("cardToggle");

const handleClick = () => {
  if (variant === "accordion" && toggle) {
    toggle();
  }
};
</script>

<style lang="scss">
.card-header + .card-content {
  @apply pt-0;
}
</style>
