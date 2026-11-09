<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("sso.scim.title") }}</CardTitle>
      <CardDescription>{{ $t("sso.scim.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="space-y-1">
        <p class="text-sm font-medium">{{ $t("sso.scim.baseUrl") }}</p>
        <p id="sso-scim-base-url" class="p-2 border rounded-md font-mono text-sm break-all">
          {{ baseUrl }}
        </p>
      </div>

      <div v-if="newToken" class="p-3 border rounded-lg space-y-2 bg-amber-50 border-amber-200">
        <p class="text-sm font-medium">{{ $t("sso.scim.shownOnce") }}</p>
        <p id="sso-scim-token" class="p-2 bg-white border rounded-md font-mono text-sm break-all">
          {{ newToken }}
        </p>
        <Button type="button" size="sm" variant="outline" @click="copyToken">
          {{ copied ? $t("sso.scim.copied") : $t("sso.scim.copy") }}
        </Button>
      </div>

      <p v-if="token" class="text-sm text-neutral-muted">
        {{
          $t("sso.scim.current", {
            prefix: token.prefix,
            created: new Date(token.createdAt).toLocaleString(),
          })
        }}
        {{
          token.lastUsedAt
            ? $t("sso.scim.lastUsed", { date: new Date(token.lastUsedAt).toLocaleString() })
            : $t("sso.scim.neverUsed")
        }}
      </p>
      <p v-else class="text-sm text-neutral-muted">{{ $t("sso.scim.noToken") }}</p>

      <p class="text-sm text-neutral-muted">{{ $t("sso.scim.rules") }}</p>

      <div class="flex gap-2">
        <Button type="button" :loading="busy" @click="createToken">
          {{ token ? $t("sso.scim.replace") : $t("sso.scim.generate") }}
        </Button>
        <Button
          v-if="token"
          type="button"
          variant="destructive"
          :loading="busy"
          @click="revokeToken"
        >
          {{ $t("sso.scim.revoke") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import type { RouterOutputs } from "@/types/trpc";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

type Scim = RouterOutputs["sso"]["getSettings"]["scim"];

defineProps<{
  baseUrl: string;
  token: Scim["token"];
}>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToast();
const busy = ref(false);
const newToken = ref("");
const copied = ref(false);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : t("sso.errors.generic");

const createToken = async () => {
  busy.value = true;
  try {
    newToken.value = (await Hay.sso.createScimToken.mutate()).token;
    copied.value = false;
    emit("changed");
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    busy.value = false;
  }
};

const revokeToken = async () => {
  busy.value = true;
  try {
    await Hay.sso.revokeScimToken.mutate();
    newToken.value = "";
    emit("changed");
    toast.success(t("sso.scim.revoked"));
  } catch (error) {
    toast.error(messageOf(error));
  } finally {
    busy.value = false;
  }
};

const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(newToken.value);
    copied.value = true;
  } catch {
    toast.error(t("sso.scim.copyFailed"));
  }
};
</script>
