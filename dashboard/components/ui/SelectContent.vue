<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { ref, onMounted, onBeforeUnmount } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { SelectContent, SelectPortal, SelectViewport, useForwardPropsEmits } from "reka-ui";
import { cn } from "@/lib/utils";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<SelectContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    position: "popper",
  },
);
const emits = defineEmits<SelectContentEmits>();

const delegatedProps = reactiveOmit(props, "class");
const forwarded = useForwardPropsEmits(delegatedProps, emits);

const contentRef = ref<any>(null);

// Watch for position changes and update CSS variable
const updatePosition = () => {
  if (!contentRef.value) return;

  // Get the actual DOM element (contentRef might be a component wrapper)
  const el = (contentRef.value as any)?.$el || contentRef.value;
  if (!el || typeof el.getBoundingClientRect !== 'function') return;

  const rect = el.getBoundingClientRect();
  // Set CSS variable with the top position
  el.style.setProperty('--dropdown-top', `${rect.top}px`);
};

onMounted(() => {
  // Use MutationObserver to watch for style changes (when Reka UI positions it)
  const observer = new MutationObserver(() => {
    updatePosition();
  });

  if (contentRef.value) {
    const el = (contentRef.value as any)?.$el || contentRef.value;
    if (el && typeof el.observe !== 'undefined') {
      observer.observe(el, { attributes: true, attributeFilter: ['style'] });
      // Initial update
      setTimeout(updatePosition, 0);
    }
  }

  onBeforeUnmount(() => observer.disconnect());
});
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'relative z-50 min-w-32 overflow-y-auto rounded-md border border-input bg-background shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          props.class,
        )
      "
      style="max-height: min(24rem, calc(100vh - var(--dropdown-top, 100px) - 16px))"
    >
      <SelectViewport
        :class="
          cn(
            'p-1',
            position === 'popper' &&
              'h-[--reka-select-trigger-height] w-full min-w-[--reka-select-trigger-width]',
          )
        "
      >
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
