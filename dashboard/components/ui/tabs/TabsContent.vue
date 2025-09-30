<template>
  <div v-if="isActive" class="pt-4">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { inject, computed } from 'vue';

const props = defineProps<{
  value: string;
}>();

const tabs = inject<any>('tabs');

const isActive = computed(() => tabs?.activeTab.value === props.value);
</script>