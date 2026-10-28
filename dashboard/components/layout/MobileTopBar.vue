<template>
  <header
    class="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
  >
    <Button
      variant="ghost"
      size="icon"
      class="h-11 w-11 shrink-0"
      :aria-label="$t('nav.openMenu')"
      data-testid="mobile-menu-button"
      @click="emit('open-menu')"
    >
      <Menu class="h-5 w-5" />
    </Button>

    <NuxtLink to="/inbox" class="flex min-w-0 flex-1 items-center gap-2 px-1">
      <span class="truncate text-base font-semibold text-foreground">
        {{ userStore.activeOrganization?.name || "Hay.chat" }}
      </span>
    </NuxtLink>

    <NuxtLink
      to="/inbox"
      class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent"
      :aria-label="$t('home.waitingCount', { count: appStore.pendingHumanCount })"
      data-testid="mobile-attention-badge"
    >
      <Bell class="h-5 w-5" />
      <span
        v-if="appStore.pendingHumanCount > 0"
        class="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold tabular-nums text-destructive-foreground"
      >
        {{ appStore.pendingHumanCount > 99 ? "99+" : appStore.pendingHumanCount }}
      </span>
    </NuxtLink>
  </header>
</template>

<script setup lang="ts">
import { Menu, Bell } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import { useUserStore } from "@/stores/user";

const emit = defineEmits<{ "open-menu": [] }>();

const appStore = useAppStore();
const userStore = useUserStore();
</script>
