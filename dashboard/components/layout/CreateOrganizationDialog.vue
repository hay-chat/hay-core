<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("createOrganization.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("createOrganization.description") }}
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-4">
        <Input
          v-model="organizationName"
          :label="$t('createOrganization.nameLabel')"
          :placeholder="$t('createOrganization.namePlaceholder')"
          :error="error"
          @keydown.enter.prevent="handleCreate"
        />
      </div>
      <DialogFooter>
        <Button variant="outline" @click="handleClose">{{ $t("common.cancel") }}</Button>
        <Button :loading="isCreating" @click="handleCreate">{{
          $t("createOrganization.createButton")
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", organization: { id: string; name: string; slug: string; role: string }): void;
}>();

const { t } = useI18n();
const { toast } = useToast();

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
  // Prevent multiple submissions
  if (isCreating.value) {
    return;
  }

  // Validate
  if (!organizationName.value.trim()) {
    error.value = t("createOrganization.nameRequired");
    return;
  }

  if (organizationName.value.trim().length < 1 || organizationName.value.trim().length > 100) {
    error.value = t("createOrganization.nameLengthError");
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
      toast.success(
        t("createOrganization.successTitle"),
        t("createOrganization.successMessage", { name: result.data.name }),
      );

      // Emit the created organization data
      emit("created", result.data);

      // Close the dialog
      handleClose();
    }
  } catch (err: unknown) {
    console.error("Failed to create organization:", err);
    error.value = (err instanceof Error && err.message) || t("createOrganization.createFailed");
    toast.error(t("createOrganization.createFailed"), error.value);
  } finally {
    isCreating.value = false;
  }
};
</script>
