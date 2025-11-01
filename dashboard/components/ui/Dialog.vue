<template>
  <HeadlessTransitionRoot :show="open" as="template">
    <HeadlessDialog class="relative z-50" @close="$emit('update:open', false)">
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

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4 text-center">
          <HeadlessTransitionChild
            as="template"
            enter="duration-300 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <HeadlessDialogPanel
              :class="[
                'w-full transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all',
                sizeClass
              ]"
            >
              <slot />
            </HeadlessDialogPanel>
          </HeadlessTransitionChild>
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
    size?: "sm" | "md" | "lg";
  }>(),
  {
    size: "md",
  }
);

defineEmits<{
  "update:open": [value: boolean];
}>();

const sizeClass = computed(() => {
  switch (props.size) {
    case "sm":
      return "max-w-md";  // 28rem (448px)
    case "md":
      return "max-w-2xl"; // 42rem (672px)
    case "lg":
      return "max-w-3xl"; // 48rem (768px)
    default:
      return "max-w-md";
  }
});
</script>
