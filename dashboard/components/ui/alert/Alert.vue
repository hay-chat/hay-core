<template>
  <div
    :class="['relative w-full rounded-lg border p-4 flex gap-4', variantStyles[variant]]"
    role="alert"
  >
    <component :is="iconComponent" class="min-h-4 min-w-4" />
    <div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { AlertCircle } from "lucide-vue-next";

interface Props {
  variant?: "default" | "destructive" | "warning" | "danger";
  icon?: Component;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
});

const iconComponent = computed(() => props.icon || AlertCircle);

const variantStyles = {
  default: "bg-background text-foreground border-border",
  destructive:
    "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
  warning:
    "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400",
  danger:
    "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100 [&>svg]:text-red-600 dark:[&>svg]:text-red-400",
};
</script>
