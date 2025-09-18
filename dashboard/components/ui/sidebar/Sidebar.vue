<template>
  <div
    v-if="collapsible === 'icon'"
    class="flex w-full flex-col bg-sidebar text-sidebar-foreground border-r border-border max-w-56 min-w-56 p-2"
  >
    <slot />
  </div>
  <ResizablePanelGroup
    v-else
    id="sidebar-panel-group"
    direction="horizontal"
    class="h-full items-stretch"
  >
    <ResizablePanel
      :id="`sidebar-panel-${side}`"
      :ref="panelRef"
      :default-size="defaultSize"
      :collapsible="collapsible === 'offcanvas'"
      :min-size="minSize"
      :max-size="maxSize"
      :class="cn('bg-sidebar text-sidebar-foreground', className)"
      @collapse="onCollapse"
      @expand="onExpand"
      @resize="onResize"
    >
      <div
        :data-sidebar="state"
        :data-collapsible="state === 'collapsed' ? collapsible : ''"
        :class="
          cn(
            'duration-200 relative h-svh w-full flex flex-col bg-transparent transition-[width,height] ease-linear',
            'group-data-[collapsible=offcanvas]:w-0',
            'group-data-[side=right]:rotate-180',
            variant === 'floating' || variant === 'inset'
              ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]'
              : 'group-data-[collapsible=icon]:w-[--sidebar-width-icon]',
          )
        "
      >
        <div
          :class="
            cn(
              'duration-200 relative h-full w-full flex flex-col transition-[width] ease-linear',
              !mobile && 'group-data-[collapsible=offcanvas]:w-[--sidebar-width]',
              mobile && 'w-[--sidebar-width]',
              'group-data-[side=right]:rotate-180',
            )
          "
        >
          <slot />
        </div>
      </div>
    </ResizablePanel>
    <ResizableHandle
      v-if="collapsible === 'offcanvas'"
      :with-handle="false"
      class="hover:bg-sidebar-border active:bg-sidebar-border h-full w-px bg-transparent transition-colors data-[resizing]:bg-sidebar-border"
    />
  </ResizablePanelGroup>
</template>

<script setup lang="ts">
import { ref, computed, provide, onMounted } from "vue";
import { cn } from "@/lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export interface SidebarProps {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  class?: any;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}

const props = withDefaults(defineProps<SidebarProps>(), {
  side: "left",
  variant: "sidebar",
  collapsible: "offcanvas",
  defaultSize: 20,
  minSize: 20,
  maxSize: 40,
});

const state = ref<"expanded" | "collapsed">("expanded");
const openMobile = ref(false);
const mobile = ref(false);
const panelRef = ref();

const className = computed(() => props.class);

const toggleSidebar = () => {
  if (props.collapsible === "offcanvas") {
    state.value = state.value === "expanded" ? "collapsed" : "expanded";
    panelRef.value?.collapse();
  } else {
    openMobile.value = !openMobile.value;
  }
};

const onCollapse = () => {
  state.value = "collapsed";
};

const onExpand = () => {
  state.value = "expanded";
};

const onResize = (size: number) => {
  document.cookie = `sidebar:size=${size}; path=/; max-age=${60 * 60 * 24 * 7}`;
};

// Check if mobile
onMounted(() => {
  const checkMobile = () => {
    mobile.value = window.innerWidth < 768;
  };
  checkMobile();
  window.addEventListener("resize", checkMobile);

  return () => {
    window.removeEventListener("resize", checkMobile);
  };
});

// Provide context
provide("sidebar", {
  state,
  open: openMobile,
  openMobile,
  mobile,
  toggleSidebar,
});
</script>
