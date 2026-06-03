<template>
  <div v-if="isActive" class="pt-4">
    <slot />
  </div>
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
</script>
