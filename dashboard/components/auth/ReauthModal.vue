<template>
  <Dialog :open="open" @update:open="(val: boolean) => $emit('update:open', val)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("reauth.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("reauth.description") }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-2">
          <Label for="password">{{ $t("reauth.passwordLabel") }}</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            :placeholder="$t('reauth.passwordPlaceholder')"
            :disabled="loading"
            autocomplete="current-password"
          />
          <p v-if="error" class="text-sm text-destructive">
            {{ error }}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="loading" @click="handleCancel">
            {{ $t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="loading || !password">
            <span v-if="loading">{{ $t("reauth.verifying") }}</span>
            <span v-else>{{ $t("common.confirm") }}</span>
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Hay } from "@/utils/api";

interface ReauthModalProps {
  open: boolean;
}

interface ReauthModalEmits {
  (e: "update:open", value: boolean): void;
  (e: "confirmed", password: string): void;
}

const props = defineProps<ReauthModalProps>();
const emit = defineEmits<ReauthModalEmits>();

const { t } = useI18n();

const password = ref("");
const loading = ref(false);
const error = ref("");

// Reset form when dialog opens/closes
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      password.value = "";
      error.value = "";
    }
  },
);

const handleSubmit = async () => {
  if (!password.value) {
    error.value = t("reauth.passwordRequired");
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
  } catch (err: unknown) {
    console.error("Password verification failed:", err);
    error.value = (err instanceof Error && err.message) || t("reauth.verifyFailed");
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
