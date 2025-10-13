<template>
  <div
    :class="
      cn('rounded-lg border bg-background text-neutral shadow-sm flex flex-col -gap-4', props.class)
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";
import { ref, provide } from "vue";

export interface CardProps {
  class?: string | string[] | Record<string, boolean>;
  variant?: "default" | "accordion";
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<CardProps>(), {
  class: "",
  variant: "default",
  defaultOpen: true,
});

const isOpen = ref(props.defaultOpen);

const toggle = () => {
  if (props.variant === "accordion") {
    isOpen.value = !isOpen.value;
  }
};

provide("cardVariant", props.variant);
provide("cardIsOpen", isOpen);
provide("cardToggle", toggle);
</script>
