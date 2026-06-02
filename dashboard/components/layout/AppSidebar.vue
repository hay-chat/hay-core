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
  CreditCard,
  Zap,
  Globe,
  ExternalLink,
  Package,
} from "lucide-vue-next";
import type { Component } from "vue";

import OrgSwitcher from "./OrgSwitcher.vue";
import NavMain from "./NavMain.vue";
import NavUser from "./NavUser.vue";

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { Hay } from "@/utils/api";
import { roleProtectedRoutes } from "@/middleware/auth.global";

const { t } = useI18n();
const userStore = useUserStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// Get current route
const route = useRoute();

// Plugin menu items
const pluginMenuItems = ref<any[]>([]);

// Map icon name strings from CUSTOM_MENU to Lucide components
const ICON_MAP: Record<string, Component> = {
  CreditCard,
  Zap,
  Globe,
  ExternalLink,
  Settings,
  Puzzle,
};

function resolveIcon(iconName?: string): Component {
  return (iconName && ICON_MAP[iconName]) || ExternalLink;
}

// Get user data from store with validation
const user = computed(() => {
  // If authenticated but missing user data, trigger logout
  if (authStore.isAuthenticated && authStore.isInitialized && !userStore.user?.id) {
    console.log("[AppSidebar] Missing user data while authenticated, logging out");
    authStore.logout();
    return {
      name: t("user.defaultName"),
      email: t("user.defaultEmail"),
      avatar: null,
    };
  }

  return {
    name: userStore.user
      ? `${userStore.user.firstName || ""} ${userStore.user.lastName || ""}`.trim() ||
        t("user.defaultName")
      : t("user.defaultName"),
    email: userStore.user?.email || t("user.defaultEmail"),
    avatar: userStore.user?.avatarUrl || null,
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

  // Get current user role
  const isAdminOrOwner = userStore.isAdmin;

  // Only show "Getting Started" if onboarding is not completed
  if (!appStore.onboardingCompleted) {
    items.push({
      title: t("nav.gettingStarted"),
      url: "/getting-started",
      icon: Sparkles,
      isActive: isPathActive("/getting-started"),
    });
  }

  items.push(
    {
      title: t("nav.dashboard"),
      url: "/dashboard",
      icon: AreaChart,
      isActive: isPathActive("/dashboard"),
    },
    {
      title: t("nav.conversations"),
      url: "/conversations",
      icon: MessageSquare,
      badge: conversationsBadge.value,
      isActive: isPathActive("/conversations"),
    },
    {
      title: t("nav.documents"),
      url: "/documents",
      icon: FileText,
      isActive: isPathActive("/documents"),
    },
    {
      title: t("nav.playbooks"),
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
  );

  // Products nav — only shown when a product-source plugin is enabled
  // (e.g. Shopify). Mirrors the marketplace's type.includes('channel') gate.
  if (appStore.enabledPlugins.some((p) => p.type?.includes("products"))) {
    items.push({
      title: t("nav.products"),
      url: "/products",
      icon: Package,
      isActive: isPathActive("/products"),
    });
  }

  // Only show Integrations if admin or owner
  if (isAdminOrOwner) {
    items.push({
      title: t("nav.integrations"),
      url: "#",
      icon: Puzzle,
      isActive: isPathActive("/integrations"),
      items: [
        {
          title: t("nav.marketplace"),
          url: "/integrations/marketplace",
          isActive: route.path === "/integrations/marketplace",
        },
        // Add enabled plugins dynamically
        ...appStore.enabledPlugins.map((plugin) => ({
          title: plugin.name,
          url: `/integrations/plugins/${encodeURIComponent(plugin.id)}`,
          isActive: route.path === `/integrations/plugins/${encodeURIComponent(plugin.id)}`,
        })),
      ],
    });
  }

  // Add external/custom menu items at root level
  const externalItems = pluginMenuItems.value
    .filter((item) => (item.parent === "root" || !item.parent) && item.external)
    .map((item) => ({
      title: item.title,
      url: item.url,
      icon: resolveIcon(item.icon),
      isActive: false,
      external: true,
    }));
  items.push(...externalItems);

  // Build Settings submenu based on role
  const settingsItems = [];

  // Admin/Owner only settings
  if (isAdminOrOwner) {
    settingsItems.push(
      {
        title: t("nav.general"),
        url: "/settings/general",
        isActive: route.path === "/settings/general",
      },
      {
        title: t("nav.agents"),
        url: "/agents",
        isActive: isPathActive("/agents"),
      },
      {
        title: t("nav.channels"),
        url: "/channels",
        isActive: isPathActive("/channels"),
      },
      {
        title: t("nav.users"),
        url: "/settings/users",
        isActive: route.path === "/settings/users",
      },
      {
        title: t("nav.privacyData"),
        url: "/settings/privacy",
        isActive: route.path === "/settings/privacy",
      },
      {
        title: t("nav.apiTokens"),
        url: "/settings/api-tokens",
        isActive: route.path === "/settings/api-tokens",
      },
      {
        title: t("nav.webchat"),
        url: "/settings/webchat",
        isActive: route.path === "/settings/webchat",
      },
      {
        title: t("nav.gitConnections"),
        url: "/settings/git-connections",
        isActive: route.path === "/settings/git-connections",
      },
    );
  }

  // Customer Privacy is available to all roles
  settingsItems.push({
    title: t("nav.customerPrivacy"),
    url: "/settings/customer-privacy",
    isActive: route.path === "/settings/customer-privacy",
  });

  // My Profile is available to all roles
  settingsItems.push({
    title: t("nav.myProfile"),
    url: "/settings/profile",
    isActive: route.path === "/settings/profile",
  });

  // Add plugin menu items for settings (if admin/owner)
  if (isAdminOrOwner) {
    settingsItems.push(
      ...pluginMenuItems.value
        .filter((item) => item.parent === "settings")
        .map((item) => ({
          title: item.title,
          url: item.url,
          isActive: route.path === item.url,
        })),
    );
  }

  items.push({
    title: t("nav.settings"),
    url: "#",
    icon: Settings,
    isActive: isPathActive("/settings"),
    items: settingsItems,
  });

  return items;
});

// Fetch plugin menu items
onMounted(async () => {
  try {
    const response = await Hay.plugins.getMenuItems.query();
    pluginMenuItems.value = response.items || [];

    // Register role restrictions for internal custom menu items
    // so direct URL navigation is also guarded by the auth middleware
    for (const item of pluginMenuItems.value) {
      if (item.roles?.length && !item.external && item.url) {
        roleProtectedRoutes[item.url] = item.roles;
      }
    }
  } catch (error) {
    console.error("Failed to fetch plugin menu items:", error);
  }
});
</script>
