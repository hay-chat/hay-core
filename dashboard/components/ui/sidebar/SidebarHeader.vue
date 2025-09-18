<template>
  <div :data-sidebar="state" :class="cn('flex flex-col gap-2 ', className)">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  class?: string | Record<string, boolean> | Array<string | Record<string, boolean>>;
}

interface SidebarContext {
  state: { value: string };
}

const props = defineProps<SidebarHeaderProps>();
const className = computed(() => props.class);

const sidebar = inject<SidebarContext>("sidebar");
const state = computed(() => sidebar?.state?.value || "expanded");
</script>
