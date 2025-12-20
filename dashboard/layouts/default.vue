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
import { useWebSocket } from "@/composables/useWebSocket";
import { useNotifications } from "@/composables/useNotifications";
import { useToast } from "@/composables/useToast";
import { onMounted } from "vue";

// Initialize WebSocket connection for real-time updates
const websocket = useWebSocket();
const notifications = useNotifications();
const { toast } = useToast();

onMounted(() => {
  // Request notification permission on mount
  notifications.requestPermission();

  // Connect to WebSocket
  websocket.connect();

  // Check for organization switch success message
  const orgSwitchSuccess = sessionStorage.getItem("org-switch-success");
  if (orgSwitchSuccess) {
    try {
      const { title, message } = JSON.parse(orgSwitchSuccess);
      toast.success(title, message);
      sessionStorage.removeItem("org-switch-success");
    } catch (error) {
      console.error("Failed to parse org-switch-success message:", error);
      sessionStorage.removeItem("org-switch-success");
    }
  }
});
</script>
