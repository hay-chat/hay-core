<template>
  <component
    :is="componentTag"
    :href="href"
    :class="['badge', `badge--${variant}`, isInteractive && 'badge--interactive']"
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
</script>

<style lang="scss">
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  transition-property: color, background-color, border-color;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
  white-space: nowrap;

  &--default {
    background-color: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  &--secondary {
    background-color: var(--color-neutral-50);
    color: var(--color-neutral-700);
  }

  &--destructive {
    background-color: var(--color-destructive);
    color: var(--color-destructive-foreground);
  }

  &--outline {
    border: 1px solid var(--color-input);
    background-color: var(--color-background);
  }

  &--success {
    background-color: rgb(220, 252, 231);
    color: rgb(22, 101, 52);
  }

  &--interactive {
    cursor: pointer;

    &.badge--default:hover {
      background-color: var(--color-primary) / 0.8;
    }

    &.badge--secondary:hover {
      background-color: var(--color-background-secondary) / 0.8;
    }

    &.badge--destructive:hover {
      background-color: var(--color-destructive) / 0.8;
    }

    &.badge--outline:hover {
      background-color: var(--color-accent);
      color: var(--color-accent-foreground);
    }

    &.badge--success:hover {
      background-color: rgb(187, 247, 208);
    }
  }
}
</style>
