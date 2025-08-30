<template>
  <component
    :is="tag"
    :href="href"
    :class="
      cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size: size,
        }),
        isActive && 'border-primary',
        props.class
      )
    "
    :aria-current="isActive ? 'page' : undefined"
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "icon",
    },
  }
);

export interface PaginationLinkProps {
  href?: string;
  isActive?: boolean;
  size?: VariantProps<typeof buttonVariants>["size"];
  class?: string;
}

const props = withDefaults(defineProps<PaginationLinkProps>(), {
  isActive: false,
  size: "icon",
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const tag = computed(() => (props.href ? "a" : "button"));

const handleClick = (event: MouseEvent) => {
  if (!props.href) {
    event.preventDefault();
  }
  emit("click", event);
};
</script>