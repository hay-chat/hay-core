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

      <Confetti v-if="confetti" ref="confettiRef" />

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
            @after-enter="onDialogEnter"
          >
            <HeadlessDialogPanel
              :class="[
                'w-full transform overflow-hidden rounded-2xl bg-background p-6 align-middle shadow-xl transition-all',
                sizeClass,
                centered ? 'text-center dialog-centered' : 'text-left',
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
    centered?: boolean;
    confetti?: boolean;
  }>(),
  {
    size: "md",
    centered: false,
    confetti: false,
  },
);

defineEmits<{
  "update:open": [value: boolean];
}>();

const confettiRef = ref<{
  fire: (options?: Record<string, unknown>) => void;
  burst: () => void;
} | null>(null);

function onDialogEnter() {
  if (props.confetti) {
    confettiRef.value?.burst();
  }
}

const sizeClass = computed(() => {
  switch (props.size) {
    case "sm":
      return "max-w-md"; // 28rem (448px)
    case "md":
      return "max-w-2xl"; // 42rem (672px)
    case "lg":
      return "max-w-3xl"; // 48rem (768px)
    default:
      return "max-w-md";
  }
});
</script>

<style scoped>
:deep(.dialog-centered h3) {
  font-size: 1.5rem;
}

:deep(.dialog-centered .dialog-footer) {
  justify-content: center;
}

:deep(.dialog-centered .dialog-footer > div) {
  margin-left: 0;
}
</style>
