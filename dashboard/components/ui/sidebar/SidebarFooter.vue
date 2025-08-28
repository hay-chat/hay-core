<template>
  <div :data-sidebar="state" :class="cn('flex flex-col gap-2', className)">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  class?: any;
}

const props = defineProps<SidebarFooterProps>();
const className = computed(() => props.class);

const sidebar = inject<any>("sidebar");
const state = computed(() => sidebar?.state?.value || "expanded");
</script>
