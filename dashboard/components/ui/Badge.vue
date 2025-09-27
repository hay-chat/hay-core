<template>
  <component
    :is="componentTag"
    :href="href"
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
      variantClasses,
      isInteractive && 'cursor-pointer',
    ]"
    @click="onClick"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success";
  href?: string;
  onClick?: () => void;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const componentTag = computed(() => (props.href ? "a" : "span"));

const isInteractive = computed(() => !!props.href || !!props.onClick);

const onClick = (event: MouseEvent) => {
  if (props.onClick) {
    props.onClick();
  }
  emit("click", event);
};

const variantClasses = computed(() => {
  const baseVariants = {
    default: "bg-primary text-primary-foreground",
    secondary: "bg-background-secondary text-secondary-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    outline: "border border-input bg-background",
    success: "bg-green-100 text-green-800",
  };

  const hoverVariants = {
    default: "hover:bg-primary/80",
    secondary: "hover:bg-background-secondary/80",
    destructive: "hover:bg-destructive/80",
    outline: "hover:bg-accent hover:text-accent-foreground",
    success: "hover:bg-green-200",
  };

  const baseClass = baseVariants[props.variant];
  const hoverClass = isInteractive.value ? hoverVariants[props.variant] : "";

  return `${baseClass} ${hoverClass}`.trim();
});
</script>
