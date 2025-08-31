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
import { computed } from "vue";
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
  TestTube,
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

const userStore = useUserStore();

// Get current route
const route = useRoute();

// Get user data from store
const user = computed(() => ({
  name: userStore.user
    ? `${userStore.user.firstName || ""} ${
        userStore.user.lastName || ""
      }`.trim() || "User"
    : "User",
  email: userStore.user?.email || "user@example.com",
  avatar: "/avatars/user.jpg",
}));

// Helper function to check if a path is active
const isPathActive = (path: string): boolean => {
  if (path === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(path);
};

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
    badge: "3",
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
  {
    title: "Queue",
    url: "/queue",
    icon: ListTodo,
    isActive: isPathActive("/queue"),
  },
  {
    title: "Playbooks",
    url: "/playbooks",
    icon: BookOpen,
    isActive: isPathActive("/playbooks"),
  },
  {
    title: "Insights",
    url: "/insights",
    icon: BarChart,
    isActive: isPathActive("/insights"),
  },
  {
    title: "Integrations",
    url: "#",
    icon: Puzzle,
    isActive: isPathActive("/integrations"),
    items: [
      {
        title: "Connectors",
        url: "/integrations/connectors",
        isActive: route.path === "/integrations/connectors",
      },
      {
        title: "Actions",
        url: "/integrations/actions",
        isActive: route.path === "/integrations/actions",
      },
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
