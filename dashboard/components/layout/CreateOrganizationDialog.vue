<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Organization</DialogTitle>
        <DialogDescription>
          Create a new organization to manage your team and resources.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-4">
        <Input
          v-model="organizationName"
          label="Organization Name"
          placeholder="Acme Corporation"
          :error="error"
          @keydown.enter="handleCreate"
        />
      </div>
      <DialogFooter>
        <Button variant="outline" @click="handleClose">Cancel</Button>
        <Button :loading="isCreating" @click="handleCreate">Create Organization</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", organization: { id: string; name: string; slug: string; role: string }): void;
}>();

const { toast } = useToast();
const userStore = useUserStore();

const isOpen = ref(props.open);
const organizationName = ref("");
const isCreating = ref(false);
const error = ref("");

// Sync internal state with prop
watch(
  () => props.open,
  (newValue) => {
    isOpen.value = newValue;
    if (newValue) {
      // Reset form when dialog opens
      organizationName.value = "";
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
  organizationName.value = "";
  error.value = "";
};

const handleCreate = async () => {
  // Validate
  if (!organizationName.value.trim()) {
    error.value = "Organization name is required";
    return;
  }

  if (organizationName.value.trim().length < 1 || organizationName.value.trim().length > 100) {
    error.value = "Organization name must be between 1 and 100 characters";
    return;
  }

  isCreating.value = true;
  error.value = "";

  try {
    const result = await Hay.organizations.create.mutate({
      name: organizationName.value.trim(),
    });

    if (result.success && result.data) {
      // Show success message
      toast.success("Organization created", `${result.data.name} has been created successfully`);

      // Emit the created organization data
      emit("created", result.data);

      // Close the dialog
      handleClose();
    }
  } catch (err: any) {
    console.error("Failed to create organization:", err);
    error.value = err.message || "Failed to create organization";
    toast.error("Failed to create organization", error.value);
  } finally {
    isCreating.value = false;
  }
};
</script>
