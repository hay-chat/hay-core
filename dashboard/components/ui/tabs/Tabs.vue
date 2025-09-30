<template>
  <div class="tabs-container">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { provide, ref, readonly, computed } from 'vue';

const props = defineProps<{
  modelValue?: string;
  defaultValue?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const activeTab = ref(props.modelValue || props.defaultValue || '');

const setActiveTab = (value: string) => {
  activeTab.value = value;
  emit('update:modelValue', value);
};

provide('tabs', {
  activeTab: readonly(activeTab),
  setActiveTab,
});
</script>