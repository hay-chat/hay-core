<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
      variantClasses
    ]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
});

const variantClasses = computed(() => {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
  };
  
  return variants[props.variant];
});
</script>