<template>
  <button
    :data-sidebar="state"
    :aria-label="state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'"
    :tabindex="collapsible === 'offcanvas' ? 0 : -1"
    :class="
      cn(
        'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex',
        '[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className,
      )
    "
    @click="toggleSidebar"
  />
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { cn } from "@/lib/utils";

interface SidebarRailProps {
  class?: any;
}

const props = defineProps<SidebarRailProps>();
const className = computed(() => props.class);

const sidebar = inject<any>("sidebar");
const state = computed(() => sidebar?.state?.value || "expanded");
const collapsible = computed(() => sidebar?.collapsible || "offcanvas");
const toggleSidebar = () => sidebar?.toggleSidebar?.();
</script>
