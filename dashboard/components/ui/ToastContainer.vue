<template>
  <div class="fixed bottom-4 right-4 z-50 max-w-sm" aria-live="polite">
    <TransitionGroup name="toast" tag="div" class="flex flex-col gap-2">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="[
          'px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300',
          toastClass(toast.type),
        ]"
      >
        <div class="flex items-center justify-between">
          <span>{{ toast.title }}</span>
          <div class="ml-4 flex items-center gap-3">
            <button
              v-if="toast.action"
              type="button"
              class="rounded px-1 underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              @click="runAction(toast)"
            >
              {{ toast.action.label }}
            </button>
            <button
              class="text-white/80 hover:text-white"
              :aria-label="$t('common.close')"
              @click="remove(toast.id)"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";
import { useToast, type Toast } from "@/composables/useToast";

const { toasts, remove } = useToast();

const toastClasses: Record<Toast["type"], string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  warning: "bg-yellow-600 text-white",
  info: "bg-blue-600 text-white",
};

const runAction = (toast: Toast) => {
  toast.action?.onClick();
  remove(toast.id);
};

const toastClass = (type: Toast["type"]): string => toastClasses[type];
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.toast-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
