<template>
  <Dialog :open="open" @update:open="(value: boolean) => (open = value)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("profile.mfa.stepUpTitle") }}</DialogTitle>
        <DialogDescription>{{ $t("profile.mfa.stepUpDescription") }}</DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <Input
          id="mfa-step-up-code"
          v-model="code"
          :label="$t('profile.mfa.codeLabel')"
          :placeholder="$t('profile.mfa.codePlaceholder')"
          autocomplete="one-time-code"
          autofocus
        />
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            {{ $t("common.cancel") }}
          </Button>
          <Button type="submit" :loading="loading" :disabled="!code.trim()">
            {{ $t("common.confirm") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";
import { useMfaStepUp } from "@/composables/useMfaStepUp";
import { useToast } from "@/composables/useToast";
import { mfaErrorKey } from "@/utils/mfa-errors";

const { t } = useI18n();
const toast = useToast();
const { open } = useMfaStepUp();

const code = ref("");
const error = ref("");
const loading = ref(false);

watch(open, (isOpen) => {
  if (isOpen) {
    code.value = "";
    error.value = "";
  }
});

const handleSubmit = async () => {
  loading.value = true;
  error.value = "";
  try {
    await Hay.auth.mfa.stepUp.mutate({ code: code.value.trim() });
    open.value = false;
    toast.success(t("profile.mfa.stepUpDone"));
  } catch (err: unknown) {
    error.value = t(mfaErrorKey(err));
  } finally {
    loading.value = false;
  }
};
</script>
