<template>
  <Sidebar
    collapsible="icon"
    v-bind="$attrs"
    class="border-r border-border bg-background text-lg mb-2"
  >
    <SidebarHeader id="sidebar-header" class="pb-2">
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
import { computed, onMounted, ref } from "vue";
import {
  Sparkles,
  MessageSquare,
  FileText,
  AreaChart,
  Settings,
  BookOpen,
  Puzzle,
} from "lucide-vue-next";

import OrgSwitcher from "./OrgSwitcher.vue";
import NavMain from "./NavMain.vue";
import NavUser from "./NavUser.vue";

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { Hay } from "@/utils/api";

const userStore = useUserStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// Get current route
const route = useRoute();

// Plugin menu items
const pluginMenuItems = ref<any[]>([]);

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
  if (path === "/dashboard") {
    return route.path === "/" || route.path === "/dashboard";
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
const navMain = computed(() => {
  const items = [];

  // Only show "Getting Started" if onboarding is not completed
  if (!appStore.onboardingCompleted) {
    items.push({
      title: "Getting Started",
      url: "/getting-started",
      icon: Sparkles,
      isActive: isPathActive("/getting-started"),
    });
  }

  items.push(
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: AreaChart,
      isActive: isPathActive("/dashboard"),
    },
    {
      title: "Conversations",
      url: "/conversations",
      icon: MessageSquare,
      badge: conversationsBadge.value,
      isActive: isPathActive("/conversations"),
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
          title: "Profile",
          url: "/settings/profile",
          isActive: route.path === "/settings/profile",
        },
        {
          title: "Agents",
          url: "/agents",
          isActive: isPathActive("/agents"),
        },
        {
          title: "General",
          url: "/settings/general",
          isActive: route.path === "/settings/general",
        },
        {
          title: "Users",
          url: "/settings/users",
          isActive: route.path === "/settings/users",
        },
        {
          title: "Privacy & Data",
          url: "/settings/privacy",
          isActive: route.path === "/settings/privacy",
        },
        {
          title: "Customer Privacy",
          url: "/settings/customer-privacy",
          isActive: route.path === "/settings/customer-privacy",
        },
        {
          title: "API Tokens",
          url: "/settings/api-tokens",
          isActive: route.path === "/settings/api-tokens",
        },
        // Add plugin menu items for settings
        ...pluginMenuItems.value
          .filter((item) => item.parent === "settings")
          .map((item) => ({
            title: item.title,
            url: item.url,
            isActive: route.path === item.url,
          })),
      ],
    },
  );

  return items;
});

// Fetch plugin menu items
onMounted(async () => {
  try {
    const response = await Hay.plugins.getMenuItems.query();
    pluginMenuItems.value = response.items || [];
  } catch (error) {
    console.error("Failed to fetch plugin menu items:", error);
  }
});
</script>
