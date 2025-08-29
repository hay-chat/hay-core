<template>
  <div class="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
    <TransitionGroup name="toast" tag="div">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="[
          'px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300',
          toastClasses[toast.type]
        ]"
      >
        <div class="flex items-center justify-between">
          <span>{{ toast.message }}</span>
          <button
            @click="remove(toast.id)"
            class="ml-4 text-white/80 hover:text-white"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";
import { useToast } from "@/composables/useToast";

const { toasts, remove } = useToast();

const toastClasses = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  warning: "bg-yellow-600 text-white",
  info: "bg-blue-600 text-white",
};
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