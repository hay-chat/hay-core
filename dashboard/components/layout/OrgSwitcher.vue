<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        v-if="userStore.activeOrganization"
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        >
          <Building2 class="size-4" />
        </div>
        <div class="flex-1 text-left">
          <p class="font-semibold">
            {{ userStore.activeOrganization.name }}
          </p>
        </div>
        <ChevronsUpDown class="ml-auto size-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="w-[--radix-dropdown-menu-trigger-width]"
      align="start"
      side="bottom"
    >
      <DropdownMenuItem
        v-for="organization in userStore.user?.organizations"
        :key="organization.id"
        class="gap-2 p-2"
        @click="userStore.setActiveOrganization(organization.id)"
      >
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          <Building2 class="size-4" />
        </div>
        <div class="flex-1">
          <p class="font-medium">
            {{ organization.name }}
          </p>
        </div>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2 p-2">
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          <Plus class="size-4" />
        </div>
        <div class="font-medium">Add organization</div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ChevronsUpDown, Plus, Building2 } from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
const userStore = useUserStore();
</script>
