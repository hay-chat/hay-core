<template>
  <button
    :class="cn(buttonVariants({ variant, size }), props.class)"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("btn-base", {
  variants: {
    variant: {
      default: "btn-default",
      destructive: "btn-destructive",
      outline: "btn-outline",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      link: "btn-link",
    },
    size: {
      default: "btn-size-default",
      sm: "btn-size-sm",
      lg: "btn-size-lg",
      icon: "btn-size-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  disabled?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "default",
  size: "default",
  disabled: false,
});
</script>

<style scoped lang="scss">
.btn-base {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;

  &:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-ring);
  }

  &:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
}

/* Variants */
.btn-default {
  background-color: var(--color-primary);
  color: var(--color-primary-foreground);

  &:hover {
    background-color: color-mix(in srgb, var(--color-primary) 90%, transparent);
  }
}

.btn-destructive {
  background-color: var(--color-destructive);
  color: var(--color-destructive-foreground);

  &:hover {
    background-color: color-mix(in srgb, var(--color-destructive) 90%, transparent);
  }
}

.btn-outline {
  border: 1px solid var(--color-input);
  background-color: var(--color-background);

  &:hover {
    background-color: var(--color-accent);
    color: var(--color-accent-foreground);
  }
}

.btn-secondary {
  background-color: var(--color-background-secondary);
  color: var(--color-secondary-foreground);

  &:hover {
    background-color: color-mix(in srgb, var(--color-background-secondary) 80%, transparent);
  }
}

.btn-ghost {
  &:hover {
    background-color: var(--color-accent);
    color: var(--color-accent-foreground);
  }
}

.btn-link {
  color: var(--color-primary);
  text-underline-offset: 4px;

  &:hover {
    text-decoration: underline;
  }
}

/* Sizes */
.btn-size-default {
  height: 2.5rem;
  padding: 0.5rem 1rem;
}

.btn-size-sm {
  height: 2.25rem;
  border-radius: 0.375rem;
  padding: 0 0.75rem;
}

.btn-size-lg {
  height: 2.75rem;
  border-radius: 0.375rem;
  padding: 0 2rem;
}

.btn-size-icon {
  height: 2.5rem;
  width: 2.5rem;
}
</style>
