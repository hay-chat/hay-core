<template>
  <SidebarProvider>
    <div class="flex h-screen w-full">
      <AppSidebar />
      <div class="flex-1 flex flex-col">
        <!-- <SidebarTrigger class="md:hidden" /> -->
        <main class="flex-1 overflow-y-auto">
          <slot />
        </main>
      </div>
    </div>
    <!-- Toast Container for all pages -->
    <ToastContainer />
  </SidebarProvider>
</template>

<script setup lang="ts">
import AppSidebar from "@/components/layout/AppSidebar.vue";
import { SidebarProvider } from "@/components/ui/sidebar";
import ToastContainer from "@/components/ui/ToastContainer.vue";
import { useWebSocket } from "@/composables/useWebSocket";
import { useNotifications } from "@/composables/useNotifications";
import { onMounted } from "vue";

// Initialize WebSocket connection for real-time updates
const websocket = useWebSocket();
const notifications = useNotifications();

onMounted(() => {
  // Request notification permission on mount
  notifications.requestPermission();

  // Connect to WebSocket
  websocket.connect();
});
</script>
