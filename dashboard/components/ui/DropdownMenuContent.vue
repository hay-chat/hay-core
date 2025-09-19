<template>
  <transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="transform scale-95 opacity-0"
    enter-to-class="transform scale-100 opacity-100"
    leave-active-class="transition duration-75 ease-in"
    leave-from-class="transform scale-100 opacity-100"
    leave-to-class="transform scale-95 opacity-0"
  >
    <MenuItems
      :class="[
        'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-background p-1 text-popover-foreground shadow-md flex flex-col',
        side === 'top' ? 'bottom-full mb-2' : 'mt-2',
        align === 'end' ? 'right-0' : 'left-0',
      ]"
    >
      <slot />
    </MenuItems>
  </transition>
</template>

<script setup lang="ts">
import { MenuItems } from "@headlessui/vue";

defineProps<{
  align?: "start" | "end";
  side?: "top" | "bottom";
}>();
</script>
