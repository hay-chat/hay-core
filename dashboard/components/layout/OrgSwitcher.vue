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
    <DropdownMenuContent class="w-[280px]" align="start" side="bottom">
      <DropdownMenuLabel>Organizations</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="organization in userStore.organizations"
        :key="organization.id"
        class="gap-2 p-2"
        :class="{
          'bg-accent': organization.id === userStore.activeOrganizationId,
          'opacity-50 cursor-wait': isSwitching,
        }"
        :disabled="isSwitching"
        @click="switchOrganization(organization.id)"
      >
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          {{ organization.name.charAt(0) }}
        </div>
        <div class="font-medium truncate flex-1 min-w-0 text-left">
          {{ organization.name }}
          <span v-if="organization.role" class="text-xs text-neutral-muted capitalize">
            {{ organization.role }}
          </span>
        </div>
        <Check
          v-if="organization.id === userStore.activeOrganizationId"
          class="size-4 flex-shrink-0"
        />
      </DropdownMenuItem>
      <DropdownMenuSeparator v-if="userStore.organizations.length > 0" />
      <DropdownMenuItem class="gap-2 p-2" @click="handleCreateOrganization">
        <div
          class="flex aspect-square size-8 items-center justify-center rounded-lg bg-background-tertiary"
        >
          <Plus class="size-4" />
        </div>
        <div class="font-medium">Create organization</div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <!-- Create Organization Dialog -->
  <CreateOrganizationDialog v-model:open="createDialogOpen" @created="handleOrganizationCreated" />
</template>

<script setup lang="ts">
import { ChevronsUpDown, Plus, Building2, Check } from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
import { useRouter } from "vue-router";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { ref } from "vue";
import CreateOrganizationDialog from "./CreateOrganizationDialog.vue";

const userStore = useUserStore();
const router = useRouter();
const { toast } = useToast();
const isSwitching = ref(false);
const createDialogOpen = ref(false);

const switchOrganization = async (organizationId: string) => {
  // Don't switch if already active or in progress
  if (organizationId === userStore.activeOrganizationId || isSwitching.value) {
    return;
  }

  isSwitching.value = true;

  try {
    // Call backend to update lastAccessedAt and log the switch
    await Hay.organizations.switchOrganization.mutate({ organizationId });

    // Update the store - this will cause all subsequent API calls to use the new org ID
    const org = await userStore.switchOrganization(organizationId);

    if (org) {
      // Show success notification
      toast.success("Organization switched", `Now viewing ${org.name}`);

      // Force a full page reload to refresh all data with the new organization context
      window.location.href = "/dashboard";
    }
  } catch (error) {
    console.error("Failed to switch organization:", error);
    toast.error("Failed to switch organization", "Please try again");

    // Revert the organization change in the store
    // This is needed because we optimistically updated it above
    if (userStore.activeOrganizationId !== organizationId) {
      userStore.setActiveOrganization(userStore.activeOrganizationId!);
    }
  } finally {
    isSwitching.value = false;
  }
};

const handleCreateOrganization = () => {
  createDialogOpen.value = true;
};

const handleOrganizationCreated = async (organization: {
  id: string;
  name: string;
  slug: string;
  role: string;
}) => {
  // Add the new organization to the user's organizations list
  userStore.organizations.push({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    role: organization.role as "owner" | "admin" | "member" | "viewer" | "contributor",
  });

  // Switch to the newly created organization
  await switchOrganization(organization.id);
};
</script>
