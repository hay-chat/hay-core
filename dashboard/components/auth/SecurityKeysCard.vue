<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("profile.mfa.keys.title") }}</CardTitle>
      <CardDescription>{{ $t("profile.mfa.keys.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <p v-if="!supported" class="text-sm text-neutral-muted">
        {{ $t("profile.mfa.keys.unsupported") }}
      </p>

      <!-- Recovery codes, shown once after the first factor is added -->
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

      <template v-else>
        <ul v-if="keys.length" class="divide-y border rounded-lg">
          <li v-for="key in keys" :key="key.id" class="flex items-center gap-3 p-3">
            <form
              v-if="renamingId === key.id"
              class="flex flex-1 items-end gap-2"
              @submit.prevent="renameKey(key.id)"
            >
              <Input
                :id="`key-name-${key.id}`"
                v-model="renameValue"
                :label="$t('profile.mfa.keys.nameLabel')"
                class="flex-1"
              />
              <Button type="submit" size="sm" :loading="loading" :disabled="!renameValue.trim()">
                {{ $t("common.save") }}
              </Button>
              <Button type="button" size="sm" variant="outline" @click="renamingId = null">
                {{ $t("common.cancel") }}
              </Button>
            </form>
            <template v-else>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ key.name }}</p>
                <p class="text-xs text-neutral-muted">
                  {{
                    key.lastUsedAt
                      ? $t("profile.mfa.keys.lastUsed", { date: formatDate(key.lastUsedAt) })
                      : $t("profile.mfa.keys.neverUsed")
                  }}
                </p>
              </div>
              <Button size="sm" variant="outline" @click="startRename(key.id, key.name)">
                {{ $t("profile.mfa.keys.rename") }}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                :loading="removingId === key.id"
                @click="removeKey(key.id)"
              >
                {{ $t("profile.mfa.keys.remove") }}
              </Button>
            </template>
          </li>
        </ul>
        <p v-else-if="status" class="text-sm text-neutral-muted">
          {{ $t("profile.mfa.keys.empty") }}
        </p>

        <form v-if="supported && status" class="space-y-4" @submit.prevent="addKey">
          <Input
            v-if="!status.enabled"
            id="webauthn-password"
            v-model="password"
            type="password"
            :label="$t('profile.mfa.passwordLabel')"
            autocomplete="current-password"
          />
          <Input
            id="webauthn-name"
            v-model="name"
            :label="$t('profile.mfa.keys.nameLabel')"
            :placeholder="$t('profile.mfa.keys.namePlaceholder')"
          />
          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
          <div class="flex gap-2">
            <Button type="submit" :loading="loading" :disabled="!status.enabled && !password">
              {{ $t("profile.mfa.keys.add") }}
            </Button>
            <Button
              v-if="keys.length && !status.totpEnabled"
              type="button"
              variant="outline"
              :loading="loading"
              @click="regenerateRecoveryCodes"
            >
              {{ $t("profile.mfa.regenerate") }}
            </Button>
          </div>
        </form>
      </template>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import type { RouterOutputs } from "@/types/trpc";
import { Hay } from "@/utils/api";
import { useMfaStatus } from "@/composables/useMfaStatus";
import { useToast } from "@/composables/useToast";
import { useUserStore, type User } from "@/stores/user";
import { askKeyToRegister, webauthnErrorKey, webauthnSupported } from "@/utils/webauthn";

const { t } = useI18n();
const toast = useToast();
const userStore = useUserStore();
const { status, loadStatus } = useMfaStatus();

const keys = ref<RouterOutputs["auth"]["mfa"]["webauthn"]["list"]>([]);
const recoveryCodes = ref<string[]>([]);
const password = ref("");
const name = ref("");
const error = ref("");
const loading = ref(false);
const renamingId = ref<string | null>(null);
const renameValue = ref("");
const removingId = ref<string | null>(null);
const supported = ref(false);

const formatDate = (value: string | Date) => new Date(value).toLocaleDateString();

const loadKeys = async () => {
  keys.value = await Hay.auth.mfa.webauthn.list.query();
};

const refresh = async () => {
  await Promise.all([loadKeys(), loadStatus()]);
  userStore.setUser((await Hay.auth.me.query()) as User);
};

/** Runs a request with the shared loading and error state. */
const run = async (action: () => Promise<void>) => {
  loading.value = true;
  error.value = "";
  try {
    await action();
  } catch (err: unknown) {
    error.value = t(webauthnErrorKey(err));
  } finally {
    loading.value = false;
  }
};

const addKey = () =>
  run(async () => {
    const optionsJSON = await Hay.auth.mfa.webauthn.registrationOptions.mutate({
      password: status.value?.enabled ? undefined : password.value,
    });
    const response = await askKeyToRegister(optionsJSON);
    const result = await Hay.auth.mfa.webauthn.verifyRegistration.mutate({
      response,
      name: name.value.trim() || undefined,
    });
    password.value = "";
    name.value = "";
    if (result.recoveryCodes) recoveryCodes.value = result.recoveryCodes;
    await refresh();
    toast.success(t("profile.mfa.keys.addedToast"));
  });

const startRename = (id: string, current: string) => {
  renamingId.value = id;
  renameValue.value = current;
};

const renameKey = (id: string) =>
  run(async () => {
    await Hay.auth.mfa.webauthn.rename.mutate({ id, name: renameValue.value.trim() });
    renamingId.value = null;
    await loadKeys();
  });

const removeKey = async (id: string) => {
  removingId.value = id;
  error.value = "";
  try {
    await Hay.auth.mfa.webauthn.remove.mutate({ id });
    await refresh();
    toast.success(t("profile.mfa.keys.removedToast"));
  } catch (err: unknown) {
    error.value = t(webauthnErrorKey(err));
  } finally {
    removingId.value = null;
  }
};

const regenerateRecoveryCodes = () =>
  run(async () => {
    const result = await Hay.auth.mfa.regenerateRecoveryCodes.mutate({});
    recoveryCodes.value = result.recoveryCodes;
    await loadStatus();
  });

const copyRecoveryCodes = async () => {
  await navigator.clipboard.writeText(recoveryCodes.value.join("\n"));
  toast.success(t("profile.mfa.copiedToast"));
};

onMounted(async () => {
  supported.value = webauthnSupported();
  await Promise.all([loadKeys(), loadStatus()]);
});
</script>
