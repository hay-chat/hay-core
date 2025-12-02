<template>
  <HeadlessTransitionRoot :show="open" as="template">
    <HeadlessDialog class="relative z-50" @close="$emit('update:open', false)">
      <!-- Backdrop -->
      <HeadlessTransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/25" />
      </HeadlessTransitionChild>

      <!-- Panel Container -->
      <div class="fixed inset-0 overflow-hidden">
        <div class="absolute inset-0 overflow-hidden">
          <div
            :class="[
              'pointer-events-none fixed inset-y-0 flex max-w-full',
              side === 'right' ? 'right-0 pl-10' : 'left-0 pr-10',
            ]"
          >
            <HeadlessTransitionChild
              as="template"
              :enter="'transform transition ease-in-out duration-300'"
              :enter-from="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
              enter-to="translate-x-0"
              :leave="'transform transition ease-in-out duration-200'"
              leave-from="translate-x-0"
              :leave-to="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
            >
              <HeadlessDialogPanel :class="['pointer-events-auto', sizeClass]">
                <div class="flex h-full flex-col bg-background shadow-xl">
                  <slot />
                </div>
              </HeadlessDialogPanel>
            </HeadlessTransitionChild>
          </div>
        </div>
      </div>
    </HeadlessDialog>
  </HeadlessTransitionRoot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Dialog as HeadlessDialog,
  TransitionRoot as HeadlessTransitionRoot,
  TransitionChild as HeadlessTransitionChild,
  DialogPanel as HeadlessDialogPanel,
} from "@headlessui/vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    side?: "left" | "right";
    size?: "sm" | "md" | "lg" | "xl" | "full";
  }>(),
  {
    side: "right",
    size: "md",
  }
);

defineEmits<{
  "update:open": [value: boolean];
}>();

const sizeClass = computed(() => {
  switch (props.size) {
    case "sm":
      return "w-screen max-w-sm"; // 24rem (384px)
    case "md":
      return "w-screen max-w-md"; // 28rem (448px)
    case "lg":
      return "w-screen max-w-lg"; // 32rem (512px)
    case "xl":
      return "w-screen max-w-xl"; // 36rem (576px)
    case "full":
      return "w-screen max-w-2xl"; // 42rem (672px)
    default:
      return "w-screen max-w-md";
  }
});
</script>
