<template>
  <div
    v-bind="{ ...(id && { id }) }"
    ref="panelRef"
    :class="cn('relative flex-auto', className)"
    :style="{
      flexBasis: `${size}%`,
    }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { cn } from "@/lib/utils";

interface ResizablePanelProps {
  id?: string;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  class?: any;
}

const props = withDefaults(defineProps<ResizablePanelProps>(), {
  defaultSize: 50,
  minSize: 0,
  maxSize: 100,
  collapsible: false,
});

const emit = defineEmits<{
  collapse: [];
  expand: [];
  resize: [size: number];
}>();

const panelRef = ref();
const size = ref(props.defaultSize);
const className = computed(() => props.class);

const collapse = () => {
  size.value = 0;
  emit("collapse");
};

const expand = () => {
  size.value = props.defaultSize;
  emit("expand");
};

defineExpose({
  collapse,
  expand,
});
</script>
