<template>
  <DropdownMenu class="w-full flex flex-col">
    <DropdownMenuTrigger as-child>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Avatar
          :name="user.name"
          :url="user.avatar"
          :status="onlineStatus"
          :show-status="true"
          size="sm"
        />
        <div class="flex-1 text-left">
          <p class="font-medium">
            {{ user.name }}
          </p>
          <p class="text-xs text-neutral-muted truncate max-w-[17ch]">
            {{ user.email }}
          </p>
        </div>
        <ChevronsUpDown class="ml-auto h-4 w-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-[--radix-dropdown-menu-trigger-width]" align="start" side="top">
      <DropdownMenuLabel>Status</DropdownMenuLabel>
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
import Avatar from "@/components/ui/Avatar.vue";

const router = useRouter();
const authStore = useAuthStore();
const userStore = useUserStore();

interface User {
  name: string;
  email: string;
  avatar?: string | null;
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
