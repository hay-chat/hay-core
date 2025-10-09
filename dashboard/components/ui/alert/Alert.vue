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
  variant?: "default" | "destructive";
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
};
</script>
