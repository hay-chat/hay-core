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
          <div class="flex items-center gap-2">
            <p class="font-semibold truncate">
              {{ userStore.activeOrganization.name }}
            </p>
            <span
              v-if="userStore.activeOrganization.role"
              class="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium capitalize"
            >
              {{ userStore.activeOrganization.role }}
            </span>
          </div>
        </div>
        <ChevronsUpDown class="ml-auto size-4 flex-shrink-0" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="w-[280px]"
      align="start"
      side="bottom"
    >
      <DropdownMenuLabel>Organizations</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="organization in userStore.organizations"
        :key="organization.id"
        class="gap-2 p-2"
        :class="{ 'bg-accent': organization.id === userStore.activeOrganizationId }"
        @click="switchOrganization(organization.id)"
      >
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          <Building2 class="size-4" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">
            {{ organization.name }}
          </p>
          <p v-if="organization.role" class="text-xs text-muted-foreground capitalize">
            {{ organization.role }}
          </p>
        </div>
        <Check v-if="organization.id === userStore.activeOrganizationId" class="size-4 flex-shrink-0" />
      </DropdownMenuItem>
      <DropdownMenuSeparator v-if="userStore.organizations.length > 0" />
      <DropdownMenuItem class="gap-2 p-2" @click="router.push('/settings/organizations')">
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          <Settings class="size-4" />
        </div>
        <div class="font-medium">Manage organizations</div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ChevronsUpDown, Settings, Building2, Check } from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
import { useRouter } from "vue-router";

const userStore = useUserStore();
const router = useRouter();

const switchOrganization = (organizationId: string) => {
  userStore.setActiveOrganization(organizationId);
  // Reload the page to ensure all data is fresh for the new organization
  window.location.reload();
};
</script>
