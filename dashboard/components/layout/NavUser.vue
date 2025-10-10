<template>
  <DropdownMenu class="w-full flex flex-col">
    <DropdownMenuTrigger as-child>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <div
          class="relative flex h-8 w-8 items-center justify-center rounded-full bg-background-tertiary"
        >
          <span class="text-sm font-medium text-foreground">
            {{
              (() => {
                if (!user.name) return "";
                const parts = user.name.trim().split(" ").filter(Boolean);
                if (parts.length === 0) return "";
                if (parts.length === 1) return parts[0][0]?.toUpperCase() || "";
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
              })()
            }}
          </span>
          <!-- Online status indicator -->
          <div
            class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background"
            :class="{
              'bg-green-500': onlineStatus === 'online',
              'bg-yellow-500': onlineStatus === 'away',
              'bg-gray-400': onlineStatus === 'offline',
            }"
          ></div>
        </div>
        <div class="flex-1 text-left">
          <p class="font-medium">
            {{ user.name }}
          </p>
          <p class="text-xs text-neutral-muted">
            {{ user.email }}
          </p>
        </div>
        <ChevronsUpDown class="ml-auto h-4 w-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-[--radix-dropdown-menu-trigger-width]" align="start" side="top">
      <DropdownMenuItem class="text-xs text-muted-foreground" disabled>Status</DropdownMenuItem>
      <DropdownMenuItem :disabled="currentStatus === 'available'" @click="setStatus('available')">
        <div class="mr-2 h-2 w-2 rounded-full bg-green-500"></div>
        Available
        <Check v-if="currentStatus === 'available'" class="ml-auto h-4 w-4" />
      </DropdownMenuItem>
      <DropdownMenuItem :disabled="currentStatus === 'away'" @click="setStatus('away')">
        <div class="mr-2 h-2 w-2 rounded-full bg-yellow-500"></div>
        Away
        <Check v-if="currentStatus === 'away'" class="ml-auto h-4 w-4" />
      </DropdownMenuItem>

      <DropdownMenuSeparator />
      <DropdownMenuItem @click="router.push('/settings/profile')">
        <User2 class="mr-2 h-4 w-4" />
        Profile
      </DropdownMenuItem>
      <!-- <DropdownMenuItem>
        <Settings class="mr-2 h-4 w-4" />
        Settings
      </DropdownMenuItem> -->
      <!-- <DropdownMenuItem>
        <Bell class="mr-2 h-4 w-4" />
        Notifications
      </DropdownMenuItem> -->
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="authStore.logout()">
        <LogOut class="mr-2 h-4 w-4" />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ChevronsUpDown, LogOut, User2, Check } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { Hay } from "@/utils/api";
import { useRouter } from "vue-router";

const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();

interface User {
  name: string;
  email: string;
  avatar?: string;
}

interface Props {
  user: User;
}

defineProps<Props>();

// Get online status from user store
const onlineStatus = computed(() => userStore.user?.onlineStatus || "offline");
const currentStatus = computed(() => userStore.user?.status || "available");

// Set user status
const setStatus = async (status: "available" | "away") => {
  try {
    await Hay.auth.updateStatus.mutate({ status });
    userStore.updateStatus(status);
  } catch (error) {
    console.error("Failed to update status:", error);
  }
};
</script>
