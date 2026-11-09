<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("profile.mfa.title") }}</CardTitle>
      <CardDescription>{{ $t("profile.mfa.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div
        v-if="enrolmentRequired && !status?.enabled"
        class="p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800"
      >
        {{ $t("profile.mfa.requiredNotice") }}
      </div>

      <!-- Recovery codes, shown once -->
      <div v-if="recoveryCodes.length" class="space-y-3">
        <p class="text-sm font-medium">{{ $t("profile.mfa.recoveryTitle") }}</p>
        <p class="text-sm text-neutral-muted">{{ $t("profile.mfa.recoveryDescription") }}</p>
        <ul class="grid grid-cols-2 gap-2 p-3 border rounded-lg font-mono text-sm">
          <li v-for="recoveryCode in recoveryCodes" :key="recoveryCode">{{ recoveryCode }}</li>
        </ul>
        <div class="flex gap-2">
          <Button variant="outline" @click="copyRecoveryCodes">
            {{ $t("profile.mfa.copyCodes") }}
          </Button>
          <Button @click="recoveryCodes = []">{{ $t("profile.mfa.savedCodes") }}</Button>
        </div>
      </div>

      <!-- Step 2: add to an authenticator app and confirm -->
      <form v-else-if="enrolment" class="space-y-4" @submit.prevent="confirmEnrolment">
        <p class="text-sm text-neutral-muted">{{ $t("profile.mfa.setupDescription") }}</p>
        <div class="p-3 border rounded-lg space-y-1">
          <p class="text-xs text-neutral-muted">{{ $t("profile.mfa.manualKey") }}</p>
          <p class="font-mono text-sm break-all">{{ enrolment.secret }}</p>
        </div>
        <a :href="enrolment.otpauthUri" class="text-sm text-primary hover:text-primary/80">
          {{ $t("profile.mfa.openInApp") }}
        </a>
        <Input
          id="mfa-confirm-code"
          v-model="code"
          :label="$t('profile.mfa.codeLabel')"
          :placeholder="$t('profile.mfa.codePlaceholder')"
          autocomplete="one-time-code"
        />
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="resetEnrolment">
            {{ $t("common.cancel") }}
          </Button>
          <Button type="submit" :loading="loading" :disabled="!code.trim()">
            {{ $t("profile.mfa.confirm") }}
          </Button>
        </div>
      </form>

      <!-- Enabled -->
      <form v-else-if="status?.enabled" class="space-y-4" @submit.prevent>
        <div class="flex items-center gap-2">
          <Badge variant="success">{{ $t("profile.mfa.enabled") }}</Badge>
          <span class="text-sm text-neutral-muted">
            {{ $t("profile.mfa.codesRemaining", { count: status.recoveryCodesRemaining }) }}
          </span>
        </div>
        <Input
          id="mfa-manage-code"
          v-model="code"
          :label="$t('profile.mfa.codeLabel')"
          :placeholder="$t('profile.mfa.codePlaceholder')"
          autocomplete="one-time-code"
        />
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <div class="flex gap-2">
          <Button
            variant="outline"
            :loading="loading"
            :disabled="!code.trim()"
            @click="regenerateRecoveryCodes"
          >
            {{ $t("profile.mfa.regenerate") }}
          </Button>
          <Button
            variant="destructive"
            :loading="loading"
            :disabled="!code.trim()"
            @click="disable"
          >
            {{ $t("profile.mfa.disable") }}
          </Button>
        </div>
      </form>

      <!-- Step 1: confirm the password -->
      <form v-else-if="status" class="space-y-4" @submit.prevent="beginEnrolment">
        <Input
          id="mfa-password"
          v-model="password"
          type="password"
          :label="$t('profile.mfa.passwordLabel')"
          autocomplete="current-password"
        />
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        <Button type="submit" :loading="loading" :disabled="!password">
          {{ $t("profile.mfa.enable") }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import type { RouterOutputs } from "@/types/trpc";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore, type User } from "@/stores/user";
import { mfaErrorKey } from "@/utils/mfa-errors";

const { t } = useI18n();
const toast = useToast();
const userStore = useUserStore();

const status = ref<RouterOutputs["auth"]["mfa"]["status"] | null>(null);
const enrolment = ref<RouterOutputs["auth"]["mfa"]["beginEnrolment"] | null>(null);
const recoveryCodes = ref<string[]>([]);
const password = ref("");
const code = ref("");
const error = ref("");
const loading = ref(false);

const enrolmentRequired = computed(() => !!userStore.user?.mfaEnrolmentRequired);

const loadStatus = async () => {
  status.value = await Hay.auth.mfa.status.query();
};

/** Runs a request with the shared loading and error state. */
const run = async (action: () => Promise<void>) => {
  loading.value = true;
  error.value = "";
  try {
    await action();
  } catch (err: unknown) {
    error.value = t(mfaErrorKey(err));
  } finally {
    loading.value = false;
  }
};

const beginEnrolment = () =>
  run(async () => {
    enrolment.value = await Hay.auth.mfa.beginEnrolment.mutate({ password: password.value });
    password.value = "";
    code.value = "";
  });

const resetEnrolment = () => {
  enrolment.value = null;
  code.value = "";
  error.value = "";
};

const confirmEnrolment = () =>
  run(async () => {
    const result = await Hay.auth.mfa.confirmEnrolment.mutate({ code: code.value.trim() });
    recoveryCodes.value = result.recoveryCodes;
    resetEnrolment();
    await loadStatus();
    userStore.setUser((await Hay.auth.me.query()) as User);
  });

const regenerateRecoveryCodes = () =>
  run(async () => {
    const result = await Hay.auth.mfa.regenerateRecoveryCodes.mutate({ code: code.value.trim() });
    recoveryCodes.value = result.recoveryCodes;
    code.value = "";
    await loadStatus();
  });

const disable = () =>
  run(async () => {
    await Hay.auth.mfa.disable.mutate({ code: code.value.trim() });
    code.value = "";
    await loadStatus();
    userStore.setUser((await Hay.auth.me.query()) as User);
    toast.success(t("profile.mfa.disabledToast"));
  });

const copyRecoveryCodes = async () => {
  await navigator.clipboard.writeText(recoveryCodes.value.join("\n"));
  toast.success(t("profile.mfa.copiedToast"));
};

onMounted(loadStatus);
</script>
