<template>
  <div
    :class="['relative w-full rounded-lg border p-4 flex gap-4', variantStyles[variant]]"
    role="alert"
  >
    <AlertCircle class="h-4 w-4" />
    <div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertCircle } from "lucide-vue-next";
interface Props {
  variant?: "default" | "destructive";
}

const _props = withDefaults(defineProps<Props>(), {
  variant: "default",
});

const variantStyles = {
  default: "bg-background text-foreground border-border",
  destructive:
    "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
};
</script>
