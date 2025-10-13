<template>
  <div
    v-if="variant === 'default' || isOpen"
    ref="contentRef"
    :class="
      cn(
        'card-content flex-1 overflow-hidden transition-all duration-200 ease-in-out p-6',
        props.class,
      )
    "
    :style="{
      maxHeight: variant === 'accordion' ? (isOpen ? maxHeight : '0px') : 'none',
      opacity: variant === 'accordion' ? (isOpen ? '1' : '0') : '1',
    }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { inject, type Ref, ref, watch, nextTick, onMounted } from "vue";
import { cn } from "@/lib/utils";

interface Props {
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  class: "",
});

const variant = inject<"default" | "accordion">("cardVariant", "default");
const isOpen = inject<Ref<boolean>>("cardIsOpen", ref(true));

const contentRef = ref<HTMLElement>();
const maxHeight = ref<string>("1000px");

const updateHeight = async () => {
  if (variant === "accordion" && contentRef.value) {
    await nextTick();
    const height = contentRef.value.scrollHeight;
    maxHeight.value = `${height}px`;
  }
};

onMounted(() => {
  updateHeight();
});

watch(
  isOpen,
  () => {
    updateHeight();
  },
  { flush: "post" },
);
</script>
