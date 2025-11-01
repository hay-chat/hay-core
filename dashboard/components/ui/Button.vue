<template>
  <component
    :is="href ? 'a' : 'button'"
    :class="cn(buttonVariants({ variant, size }), props.class)"
    :disabled="!href && (disabled || loading)"
    :href="href"
    :target="target"
    :rel="target === '_blank' ? 'noopener noreferrer' : undefined"
    v-bind="$attrs"
  >
    <div class="btn-content" :class="{ 'btn-content-loading': loading }">
      <slot />
    </div>
    <svg
      v-if="loading"
      :class="`btn-loading-spinner btn-loading-${size}`"
      viewBox="0 0 278 253"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M267.358 244.185C267.358 244.185 73.8552 253 0 253C13.6652 202.001 95.5 229.114 113.738 234.001C162 228.124 191 216.001 200.888 228.124C215 217.001 270.5 206.5 267.358 244.185Z"
        fill="currentColor"
        class="peak-base"
      />
      <path
        d="M267.358 244.184C267.358 244.184 232.855 239.5 159 239.5L200.888 150.153C305.764 -86.3931 276.221 129.584 267.358 244.184Z"
        fill="currentColor"
        class="peak-3"
      />
      <path
        d="M200.888 150.154C200.888 203.5 204 214.5 204 242H87.5L113.738 156.03C166.914 -30.5621 200.888 -70.2314 200.888 150.154Z"
        fill="currentColor"
        class="peak-2"
      />
      <path
        d="M113.738 234C113.738 234 73.8552 253 0 253C60.5611 32.6151 100.443 -104.024 113.738 156.03V234Z"
        fill="currentColor"
        class="peak-1"
      />
    </svg>
  </component>
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
      success: "btn-success",
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
  loading?: boolean;
  class?: string;
  href?: string;
  target?: string;
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "default",
  size: "default",
  disabled: false,
  loading: false,
});
</script>

<style scoped lang="scss">
.btn-base {
  position: relative;
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

.btn-success {
  background-color: var(--color-green-600);
  color: #ffffff;

  &:hover {
    background-color: var(--color-green-700);
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

/* Button content wrapper */
.btn-content {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 150ms ease-in-out;
}

.btn-content-loading {
  opacity: 0;
}

/* Loading spinner */
.btn-loading-spinner {
  position: absolute;
  width: auto;
  height: 1.25rem;
}

.btn-loading-sm {
  height: 1rem;
}

.btn-loading-default {
  height: 1.25rem;
}

.btn-loading-lg {
  height: 1.5rem;
}

.btn-loading-icon {
  height: 1.25rem;
}

@keyframes pulse {
  0% {
    transform: scaleY(0.6);
  }
  50% {
    transform: scaleY(1);
  }
}

.peak-1,
.peak-2,
.peak-3 {
  animation: pulse 600ms infinite cubic-bezier(0.4, 0, 0.2, 1) forwards alternate;
  transform-origin: bottom;
  --interval: 120ms;
}

.peak-2 {
  animation-delay: var(--interval);
}

.peak-3 {
  animation-delay: calc(var(--interval) * 2);
}
</style>
