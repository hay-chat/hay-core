<template>
  <SidebarProvider>
    <div class="flex h-dvh w-full">
      <!-- Desktop navigation -->
      <div class="hidden md:flex">
        <AppSidebar />
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- Phone navigation: top bar + drawer -->
        <MobileTopBar @open-menu="menuOpen = true" />
        <Sheet :open="menuOpen" side="left" size="sm" @update:open="menuOpen = $event">
          <AppSidebar variant="drawer" />
        </Sheet>

        <!-- Operator notice (e.g. trial ending, payment failed) -->
        <AccessNoticeBanner />
        <main class="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
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
import { usePushNotifications } from "@/composables/usePushNotifications";
import { usePluginTranslations } from "@/composables/usePluginTranslations";
import { useToast } from "@/composables/useToast";
import { useServerStatus } from "@/composables/useServerStatus";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { onMounted, onUnmounted, ref, watch } from "vue";

// Initialize WebSocket connection for real-time updates
const websocket = useWebSocket();
const notifications = useNotifications();
const pushNotifications = usePushNotifications();
const { loadTranslations: loadPluginTranslations } = usePluginTranslations();
const { toast } = useToast();
const serverStatus = useServerStatus();
const appStore = useAppStore();
const authStore = useAuthStore();
const userStore = useUserStore();
const route = useRoute();

const menuOpen = ref(false);
// Navigating closes the drawer
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

// Keep the "waiting for a human" badge current without polling
const BADGE_EVENTS = [
  "conversation_status_changed",
  "conversation_taken_over",
  "conversation_released",
  "conversation_created",
];
const unsubscribers: Array<() => void> = [];
const refreshBadge = () => {
  void appStore.fetchPendingHumanCount();
};

onMounted(() => {
  // Request notification permission on mount
  notifications.requestPermission();

  // Connect to WebSocket
  websocket.connect();
  for (const event of BADGE_EVENTS) {
    unsubscribers.push(websocket.on(event, refreshBadge));
  }

  // Sidebar/top-bar data (counts, plugin menu entries)
  if (authStore.isAuthenticated) {
    void appStore.getOpenConversationsCount();
    void appStore.fetchPendingHumanCount();
    void appStore.getPlugins();
  }

  // Re-attach this device's push subscription when the active org changed
  void pushNotifications.sync(userStore.activeOrganization?.id);

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
  unsubscribers.forEach((off) => off());
});
</script>
