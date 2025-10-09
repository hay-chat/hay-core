<template>
  <Dialog :open="open" @update:open="(val: boolean) => $emit('update:open', val)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Confirm Your Identity</DialogTitle>
        <DialogDescription>
          Please enter your current password to continue with this security-sensitive action.
        </DialogDescription>
      </DialogHeader>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div class="space-y-2">
          <Label for="password">Current Password</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            placeholder="Enter your current password"
            :disabled="loading"
            autocomplete="current-password"
          />
          <p v-if="error" class="text-sm text-destructive">
            {{ error }}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            @click="handleCancel"
            :disabled="loading"
          >
            Cancel
          </Button>
          <Button type="submit" :disabled="loading || !password">
            <span v-if="loading">Verifying...</span>
            <span v-else>Confirm</span>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

interface ReauthModalProps {
  open: boolean;
}

interface ReauthModalEmits {
  (e: "update:open", value: boolean): void;
  (e: "confirmed", password: string): void;
}

const props = defineProps<ReauthModalProps>();
const emit = defineEmits<ReauthModalEmits>();

const toast = useToast();

const password = ref("");
const loading = ref(false);
const error = ref("");

// Reset form when dialog opens/closes
watch(() => props.open, (newVal) => {
  if (newVal) {
    password.value = "";
    error.value = "";
  }
});

const handleSubmit = async () => {
  if (!password.value) {
    error.value = "Password is required";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // Verify the password with the backend
    await Hay.auth.verifyPassword.mutate({
      password: password.value,
    });

    // If verification succeeds, emit the password and close modal
    emit("confirmed", password.value);
    emit("update:open", false);

    // Reset form
    password.value = "";
  } catch (err: any) {
    console.error("Password verification failed:", err);
    error.value = err.message || "Password verification failed. Please try again.";
  } finally {
    loading.value = false;
  }
};

const handleCancel = () => {
  password.value = "";
  error.value = "";
  emit("update:open", false);
};
</script>
