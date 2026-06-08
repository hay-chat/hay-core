<template>
  <SidebarProvider>
    <div class="flex h-screen w-full">
      <AppSidebar />
      <div class="flex-1 flex flex-col">
        <!-- <SidebarTrigger class="md:hidden" /> -->
        <main class="flex-1 overflow-y-auto bg-neutral-50">
          <slot />
        </main>
      </div>
    </div>
    <!-- Global red/green topbar shown when the server is unreachable -->
    <ServerStatusBanner />
    <!-- Toast Container for all pages -->
    <ToastContainer />
  </SidebarProvider>
</template>

<script setup lang="ts">
import { useWebSocket } from "@/composables/useWebSocket";
import { useNotifications } from "@/composables/useNotifications";
import { usePluginTranslations } from "@/composables/usePluginTranslations";
import { useToast } from "@/composables/useToast";
import { useServerStatus } from "@/composables/useServerStatus";
import { onMounted, onUnmounted } from "vue";

// Initialize WebSocket connection for real-time updates
const websocket = useWebSocket();
const notifications = useNotifications();
const { loadTranslations: loadPluginTranslations } = usePluginTranslations();
const { toast } = useToast();
const serverStatus = useServerStatus();

onMounted(() => {
  // Request notification permission on mount
  notifications.requestPermission();

  // Connect to WebSocket
  websocket.connect();

  // Start polling /v1/health so we can surface a banner when the server is down
  serverStatus.startMonitoring();

  // Load plugin i18n translations
  loadPluginTranslations();

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

onUnmounted(() => {
  serverStatus.stopMonitoring();
});
</script>
