<template>
  <DropdownMenu class="w-full flex flex-col">
    <DropdownMenuTrigger asChild>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-background-tertiary"
        >
          <User2 class="h-4 w-4" />
        </div>
        <div class="flex-1 text-left">
          <p class="font-medium">{{ user.name }}</p>
          <p class="text-xs text-muted-foreground">{{ user.email }}</p>
        </div>
        <ChevronsUpDown class="ml-auto h-4 w-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="w-[--radix-dropdown-menu-trigger-width]"
      align="start"
      side="top"
    >
      <DropdownMenuItem>
        <User2 class="mr-2 h-4 w-4" />
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem>
        <Settings class="mr-2 h-4 w-4" />
        Settings
      </DropdownMenuItem>
      <DropdownMenuItem>
        <Bell class="mr-2 h-4 w-4" />
        Notifications
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="authStore.logout()">
        <LogOut class="mr-2 h-4 w-4" />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ChevronsUpDown, LogOut, Settings, User2, Bell } from "lucide-vue-next";
const authStore = useAuthStore();

interface User {
  name: string;
  email: string;
  avatar?: string;
}

interface Props {
  user: User;
}

defineProps<Props>();
</script>
