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
              class="w-full max-w-md transform overflow-hidden rounded-2xl bg-background p-6 text-left align-middle shadow-xl transition-all"
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
import {
  Dialog as HeadlessDialog,
  TransitionRoot as HeadlessTransitionRoot,
  TransitionChild as HeadlessTransitionChild,
  DialogPanel as HeadlessDialogPanel,
} from "@headlessui/vue";

defineProps<{
  open: boolean;
}>();

defineEmits<{
  "update:open": [value: boolean];
}>();
</script>
