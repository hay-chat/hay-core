<template>
  <Sidebar
    collapsible="icon"
    v-bind="$attrs"
    class="border-r border-border bg-background text-lg font-semibold mb-2"
  >
    <SidebarHeader class="pb-2">
      <OrgSwitcher />
    </SidebarHeader>
    <SidebarContent>
      <NavMain :items="navMain" />
    </SidebarContent>
    <SidebarFooter>
      <NavUser :user="user" />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import {
  Home,
  MessageSquare,
  FileText,
  Users,
  Settings,
  BarChart,
  BookOpen,
  Puzzle,
  ListTodo,
} from "lucide-vue-next";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";

import OrgSwitcher from "./OrgSwitcher.vue";
import NavMain from "./NavMain.vue";
import NavUser from "./NavUser.vue";

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";

const userStore = useUserStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// Get current route
const route = useRoute();

// Get user data from store with validation
const user = computed(() => {
  // If authenticated but missing user data, trigger logout
  if (authStore.isAuthenticated && authStore.isInitialized && !userStore.user?.id) {
    console.log("[AppSidebar] Missing user data while authenticated, logging out");
    authStore.logout();
    return {
      name: "User",
      email: "user@example.com",
      avatar: "/avatars/user.jpg",
    };
  }

  return {
    name: userStore.user
      ? `${userStore.user.firstName || ""} ${userStore.user.lastName || ""}`.trim() || "User"
      : "User",
    email: userStore.user?.email || "user@example.com",
    avatar: "/avatars/user.jpg",
  };
});

// Helper function to check if a path is active
const isPathActive = (path: string): boolean => {
  if (path === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(path);
};

// Get conversations count for badge
const conversationsBadge = computed(() => {
  const count = appStore.openConversationsCount;
  return count > 0 ? count.toString() : undefined;
});

// Initialize data on component mount
onMounted(async () => {
  if (authStore.isAuthenticated) {
    await appStore.getOpenConversationsCount();
    await appStore.getPlugins(); // Load plugins for sidebar
  }
});

// Make navMain reactive to route changes
const navMain = computed(() => [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
    isActive: isPathActive("/"),
  },
  {
    title: "Conversations",
    url: "/conversations",
    icon: MessageSquare,
    badge: conversationsBadge.value,
    isActive: isPathActive("/conversations"),
  },
  {
    title: "Agents",
    url: "/agents",
    icon: Users,
    isActive: isPathActive("/agents"),
  },
  {
    title: "Documents",
    url: "/documents",
    icon: FileText,
    isActive: isPathActive("/documents"),
  },
  // {
  //   title: "Queue",
  //   url: "/queue",
  //   icon: ListTodo,
  //   isActive: isPathActive("/queue"),
  // },
  {
    title: "Playbooks",
    url: "/playbooks",
    icon: BookOpen,
    isActive: isPathActive("/playbooks"),
  },
  // {
  //   title: "Insights",
  //   url: "/insights",
  //   icon: BarChart,
  //   isActive: isPathActive("/insights"),
  // },
  {
    title: "Integrations",
    url: "#",
    icon: Puzzle,
    isActive: isPathActive("/integrations"),
    items: [
      {
        title: "Marketplace",
        url: "/integrations/marketplace",
        isActive: route.path === "/integrations/marketplace",
      },
      // Add enabled plugins dynamically
      ...appStore.enabledPlugins.map((plugin) => ({
        title: plugin.name,
        url: `/integrations/plugins/${plugin.id}`,
        isActive: route.path === `/integrations/plugins/${plugin.id}`,
      })),
    ],
  },
  {
    title: "Settings",
    url: "#",
    icon: Settings,
    isActive: isPathActive("/settings"),
    items: [
      {
        title: "General",
        url: "/settings/general",
        isActive: route.path === "/settings/general",
      },
      {
        title: "Security",
        url: "/settings/security",
        isActive: route.path === "/settings/security",
      },
      {
        title: "Billing",
        url: "/settings/billing",
        isActive: route.path === "/settings/billing",
      },
    ],
  },
]);
</script>
