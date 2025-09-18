<template>
  <div
    :class="
      cn('group/sidebar-wrapper flex min-h-screen w-full', sidebarOpen && 'sidebar-open', className)
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, provide, computed } from "vue";
import { cn } from "@/lib/utils";

interface SidebarProviderProps {
  defaultOpen?: boolean;
  open?: boolean;
  class?: any;
}

const props = withDefaults(defineProps<SidebarProviderProps>(), {
  defaultOpen: true,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const className = computed(() => props.class);
const sidebarOpen = ref(props.open ?? props.defaultOpen);

const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value;
  emit("update:open", sidebarOpen.value);
};

provide("sidebar-provider", {
  open: sidebarOpen,
  toggleSidebar,
});
</script>
