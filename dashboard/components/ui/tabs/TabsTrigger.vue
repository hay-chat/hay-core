<template>
  <button
    :class="[
      'px-4 py-2 font-medium text-sm transition-all border-b-2',
      isActive
        ? 'border-primary text-primary'
        : 'border-transparent text-neutral-muted hover:text-neutral-foreground',
    ]"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { inject, computed } from "vue";
import type { Ref } from "vue";

const props = defineProps<{
  value: string;
}>();

interface TabsContext {
  activeTab: Ref<string>;
  setActiveTab: (value: string) => void;
}

const tabs = inject<TabsContext>("tabs");

const isActive = computed(() => tabs?.activeTab.value === props.value);

const handleClick = () => {
  tabs?.setActiveTab(props.value);
};
</script>
