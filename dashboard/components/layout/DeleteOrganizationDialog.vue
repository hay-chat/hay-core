<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle class="text-destructive">Delete Organization</DialogTitle>
        <DialogDescription>
          This action cannot be undone. This will permanently delete the organization and all
          associated data.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-4">
        <div class="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p class="text-sm text-destructive font-medium mb-2">Warning: This will immediately:</p>
          <ul class="text-sm text-destructive/90 space-y-1 list-disc list-inside">
            <li>Stop all active conversations</li>
            <li>Delete all agents, playbooks, and documents</li>
            <li>Remove all team members from the organization</li>
            <li>Delete all customer data and conversation history</li>
            <li>Invalidate all API keys</li>
          </ul>
          <p class="text-sm text-destructive font-bold mt-3">This action is irreversible.</p>
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium">
            Type <span class="font-mono font-bold">DELETE</span> to confirm
          </label>
          <Input
            v-model="confirmText"
            placeholder="DELETE"
            :error="error"
            @keydown.enter.prevent="handleDelete"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="handleClose">Never mind</Button>
        <Button
          variant="destructive"
          :loading="isDeleting"
          :disabled="confirmText !== 'DELETE'"
          @click="handleDelete"
        >
          Delete Organization
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

const props = defineProps<{
  open: boolean;
  organizationName: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "deleted"): void;
}>();

const { toast } = useToast();
const authStore = useAuthStore();
const userStore = useUserStore();

const isOpen = ref(props.open);
const confirmText = ref("");
const isDeleting = ref(false);
const error = ref("");

// Sync internal state with prop
watch(
  () => props.open,
  (newValue) => {
    isOpen.value = newValue;
    if (newValue) {
      // Reset form when dialog opens
      confirmText.value = "";
      error.value = "";
    }
  },
);

// Sync internal state back to parent
watch(isOpen, (newValue) => {
  emit("update:open", newValue);
});

const handleClose = () => {
  isOpen.value = false;
  confirmText.value = "";
  error.value = "";
};

const handleDelete = async () => {
  // Prevent multiple submissions
  if (isDeleting.value) {
    return;
  }

  // Validate confirmation text
  if (confirmText.value !== "DELETE") {
    error.value = "Please type DELETE to confirm";
    return;
  }

  isDeleting.value = true;
  error.value = "";

  try {
    const result = await Hay.organizations.delete.mutate();

    if (result.success) {
      toast.success(
        "Organization deleted",
        `${props.organizationName} has been permanently deleted.`,
      );

      // Emit deleted event
      emit("deleted");

      // Close the dialog
      handleClose();

      // Check if user has other organizations
      const remainingOrgs = userStore.organizations.filter(
        (org) => org.id !== userStore.activeOrganizationId,
      );

      if (remainingOrgs.length > 0) {
        // Switch to another organization
        userStore.setActiveOrganization(remainingOrgs[0].id);
        userStore.organizations = remainingOrgs;
        // Reload the page to refresh all data
        window.location.href = "/";
      } else {
        // No more organizations, log out
        authStore.clearTokens();
        userStore.clearUser();
        window.location.href = "/login";
      }
    }
  } catch (err: any) {
    console.error("Failed to delete organization:", err);
    error.value = err.message || "Failed to delete organization";
    toast.error("Failed to delete organization", error.value);
  } finally {
    isDeleting.value = false;
  }
};
</script>
