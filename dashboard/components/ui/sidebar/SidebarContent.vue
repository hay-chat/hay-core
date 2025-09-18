<template>
  <div
    :data-sidebar="state"
    :class="
      cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { cn } from "@/lib/utils";

interface SidebarContentProps {
  class?: any;
}

const props = defineProps<SidebarContentProps>();
const className = computed(() => props.class);

const sidebar = inject<any>("sidebar");
const state = computed(() => sidebar?.state?.value || "expanded");
</script>
