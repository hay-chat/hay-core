<template>
  <!-- Drawer variant: same navigation, rendered inside the mobile Sheet -->
  <div v-if="variant === 'drawer'" class="flex h-full flex-col gap-2 p-2">
    <div class="pb-2">
      <OrgSwitcher />
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <NavMain :items="navMain" />
    </div>
    <div class="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <NavUser :user="user" />
    </div>
  </div>
  <Sidebar
    v-else
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
  Inbox,
  MessageSquare,
  AreaChart,
  Settings,
  BookOpen,
  Puzzle,
  FileCheck,
  FlaskConical,
} from "lucide-vue-next";

import OrgSwitcher from "./OrgSwitcher.vue";
import NavMain from "./NavMain.vue";
import NavUser from "./NavUser.vue";

import { useUserStore } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { useAppStore } from "@/stores/app";
import { Hay } from "@/utils/api";
import { roleProtectedRoutes } from "@/middleware/auth.global";
import type { RouterOutputs } from "@/types/trpc";

type PluginMenuItem = RouterOutputs["plugins"]["getMenuItems"]["items"][number];

withDefaults(defineProps<{ variant?: "sidebar" | "drawer" }>(), { variant: "sidebar" });

const { t } = useI18n();
const userStore = useUserStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// Get current route
const route = useRoute();

// Plugin menu items
const pluginMenuItems = ref<PluginMenuItem[]>([]);

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
const isPathActive = (path: string): boolean => route.path.startsWith(path);

// Get conversations count for badge
const conversationsBadge = computed(() => {
  const count = appStore.openConversationsCount;
  return count > 0 ? count.toString() : undefined;
});

// Conversations waiting for a human: what the Inbox lists
const inboxBadge = computed(() => {
  const count = appStore.pendingHumanCount;
  return count > 0 ? count.toString() : undefined;
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
      title: t("nav.inbox"),
      url: "/inbox",
      icon: Inbox,
      badge: inboxBadge.value,
      isActive: isPathActive("/inbox"),
    },
    {
      title: t("nav.conversations"),
      url: "/conversations",
      icon: MessageSquare,
      badge: conversationsBadge.value,
      isActive: isPathActive("/conversations"),
    },
  );

  // Products only appear when a product-source plugin is enabled (e.g. Shopify).
  // Mirrors the marketplace's type.includes('channel') gate.
  const knowledgeItems = [
    { title: t("nav.documents"), url: "/documents", isActive: isPathActive("/documents") },
    { title: t("nav.playbooks"), url: "/playbooks", isActive: isPathActive("/playbooks") },
  ];
  if (appStore.enabledPlugins.some((p) => p.type?.includes("products"))) {
    knowledgeItems.push({
      title: t("nav.products"),
      url: "/products",
      isActive: isPathActive("/products"),
    });
  }

  // Insights and feedback on AI replies; the agent role cannot open /insights.
  const qualityItems = [{ title: t("nav.tests"), url: "/tests", isActive: isPathActive("/tests") }];
  if (!userStore.isAgent) {
    qualityItems.push(
      {
        title: t("nav.insights"),
        url: "/insights",
        isActive: isPathActive("/insights") && !isPathActive("/insights/feedback"),
      },
      {
        title: t("nav.feedback"),
        url: "/insights/feedback",
        isActive: isPathActive("/insights/feedback"),
      },
    );
  }

  const complianceItems = [
    { title: t("nav.actionLog"), url: "/actions", isActive: isPathActive("/actions") },
    { title: t("nav.evidencePacks"), url: "/evidence", isActive: isPathActive("/evidence") },
  ];

  items.push(
    {
      title: t("nav.knowledge"),
      url: "#",
      icon: BookOpen,
      isActive: knowledgeItems.some((item) => item.isActive),
      items: knowledgeItems,
    },
    {
      title: t("nav.quality"),
      url: "#",
      icon: FlaskConical,
      isActive: qualityItems.some((item) => item.isActive),
      items: qualityItems,
    },
    {
      title: t("nav.compliance"),
      url: "#",
      icon: FileCheck,
      isActive: complianceItems.some((item) => item.isActive),
      items: complianceItems,
    },
  );

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

  // Settings submenu: one entry per section, linking to its first visible tab
  const settingsItems = SETTINGS_NAV.flatMap((section) => {
    const tabs = visibleSettingsTabs(section, !!isAdminOrOwner);
    if (!tabs.length) return [];
    return [
      {
        title: t(section.labelKey),
        url: tabs[0].path,
        isActive: tabs.some((tab) => isSettingsTabActive(tab, route.path)),
      },
    ];
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
    isActive: isPathActive("/settings") || settingsItems.some((item) => item.isActive),
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
