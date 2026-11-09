<template>
  <Dialog :open="open" @update:open="(value: boolean) => (open = value)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("profile.mfa.stepUpTitle") }}</DialogTitle>
        <DialogDescription>{{ $t("profile.mfa.stepUpDescription") }}</DialogDescription>
      </DialogHeader>

      <div v-if="status?.webauthnCount" class="space-y-2">
        <Button type="button" class="w-full" :loading="loading" @click="handleSecurityKey">
          {{ $t("profile.mfa.keys.use") }}
        </Button>
        <p v-if="status.totpEnabled" class="text-center text-xs text-neutral-muted">
          {{ $t("profile.mfa.keys.orCode") }}
        </p>
      </div>

      <form
        v-if="!status || status.totpEnabled || !status.webauthnCount"
        class="space-y-4"
        @submit.prevent="handleSubmit"
      >
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
import { useMfaStatus } from "@/composables/useMfaStatus";
import { useMfaStepUp } from "@/composables/useMfaStepUp";
import { useToast } from "@/composables/useToast";
import { askKeyToSign, webauthnErrorKey } from "@/utils/webauthn";

const { t } = useI18n();
const toast = useToast();
const { open } = useMfaStepUp();
const { status, loadStatus } = useMfaStatus();

const code = ref("");
const error = ref("");
const loading = ref(false);

watch(open, (isOpen) => {
  if (isOpen) {
    code.value = "";
    error.value = "";
    loadStatus().catch(() => undefined);
  }
});

/** Runs a confirmation with the shared loading and error state. */
const confirm = async (action: () => Promise<unknown>) => {
  loading.value = true;
  error.value = "";
  try {
    await action();
    open.value = false;
    toast.success(t("profile.mfa.stepUpDone"));
  } catch (err: unknown) {
    error.value = t(webauthnErrorKey(err));
  } finally {
    loading.value = false;
  }
};

const handleSubmit = () => confirm(() => Hay.auth.mfa.stepUp.mutate({ code: code.value.trim() }));

const handleSecurityKey = () =>
  confirm(async () => {
    const optionsJSON = await Hay.auth.mfa.webauthn.stepUpOptions.mutate();
    const response = await askKeyToSign(optionsJSON);
    await Hay.auth.mfa.webauthn.stepUp.mutate({ response });
  });
</script>
