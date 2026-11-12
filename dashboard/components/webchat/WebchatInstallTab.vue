<template>
  <section class="pb-6" data-testid="webchat-install">
    <div
      class="flex flex-wrap items-center gap-3 rounded-lg border bg-neutral-50 px-4 py-3"
      data-testid="webchat-install-band"
    >
      <span :class="['rounded-full px-2.5 py-0.5 text-xs font-semibold', band.tone]">
        {{ band.pill }}
      </span>
      <p class="min-w-0 flex-1 text-sm text-neutral-700">{{ band.text }}</p>
      <a
        v-if="status === 'live' && seenUrl"
        :href="seenUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm font-medium text-primary hover:underline"
      >
        {{ $t("webchat.install.open", { host: seenHost }) }}
      </a>
    </div>
  </section>

  <section class="space-y-4 py-6">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.install.addToWebsite") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.install.addToWebsiteHint") }}</p>
    </div>
    <div class="relative rounded-lg border bg-neutral-50 p-4">
      <pre
        class="overflow-x-auto pr-20 text-xs leading-relaxed text-neutral-700"
        data-testid="webchat-snippet"
        >{{ snippet }}</pre>
      <div class="absolute right-3 top-3">
        <Button variant="outline" size="sm" @click="copy(snippet, 'snippet')">
          <Check v-if="copied === 'snippet'" class="mr-1 h-3 w-3" />
          <Copy v-else class="mr-1 h-3 w-3" />
          {{ copied === "snippet" ? $t("apiTokens.copied") : $t("apiTokens.copy") }}
        </Button>
      </div>
    </div>
    <a :href="mailto" class="inline-block text-sm font-medium text-primary hover:underline">
      {{ $t("webchat.install.emailDeveloper") }}
    </a>
  </section>

  <section class="space-y-4 py-6">
    <h2 class="text-base">{{ $t("webchat.install.whereItRuns") }}</h2>
    <Input
      id="webchat-allowed-domains"
      v-model="form.allowedDomains"
      type="textarea"
      :label="$t('webchat.install.allowedWebsites')"
      :placeholder="$t('webchat.install.allowedWebsitesPlaceholder')"
      :hint="$t('webchat.install.allowedWebsitesHint')"
      :rows="3"
    />
  </section>

  <section class="space-y-4 py-6">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.install.signedIn") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.install.signedInHint") }}</p>
    </div>
    <pre
      v-if="secret"
      class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-neutral-50 p-3 font-mono text-sm text-neutral-700"
      data-testid="webchat-secret"
      >{{ secret }}</pre>
    <p v-else class="text-sm text-neutral-500">{{ $t("webchat.install.secretHidden") }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!secret" variant="outline" size="sm" :loading="revealing" @click="revealSecret">
        {{ $t("webchat.install.showSecret") }}
      </Button>
      <Button v-else variant="outline" size="sm" @click="copy(secret, 'secret')">
        <Check v-if="copied === 'secret'" class="mr-1 h-3 w-3" />
        <Copy v-else class="mr-1 h-3 w-3" />
        {{ copied === "secret" ? $t("apiTokens.copied") : $t("apiTokens.copy") }}
      </Button>
      <Button variant="outline" size="sm" @click="rotateOpen = true">
        {{ $t("webchat.install.replaceSecret") }}
      </Button>
    </div>
    <p class="text-sm text-neutral-500">{{ $t("webchat.install.replaceSecretNow") }}</p>
  </section>

  <section class="space-y-4 py-6">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.install.pageActions") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.install.pageActionsHint") }}</p>
    </div>
    <Input
      v-model="form.pageToolsEnabled"
      type="switch"
      :label="$t('webchat.install.allowPageActions')"
    />
    <Input
      v-if="form.pageToolsEnabled"
      id="webchat-page-tools-origins"
      v-model="form.pageToolsOrigins"
      type="textarea"
      :label="$t('webchat.install.pageActionsOrigins')"
      :placeholder="$t('webchat.install.allowedWebsitesPlaceholder')"
      :hint="$t('webchat.install.pageActionsOriginsHint')"
      :rows="3"
    />
  </section>

  <ConfirmDialog
    v-model:open="rotateOpen"
    :title="$t('webchat.install.replaceSecretTitle')"
    :description="$t('webchat.install.replaceSecretDescription')"
    :confirm-text="$t('webchat.install.replaceSecret')"
    :destructive="true"
    :loading="rotating"
    @confirm="rotateSecret"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Copy } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useDomain } from "@/composables/useDomain";
import { useToast } from "@/composables/useToast";
import { useWebchatSettings } from "@/composables/useWebchatSettings";
import { useUserStore } from "@/stores/user";
import { buildWebchatSnippet } from "@/utils/webchat-snippet";
import {
  formatSince,
  webchatInstallStatus,
  websiteHost,
  websiteUrl,
} from "@/utils/webchat-settings";

const { t, locale } = useI18n();
const toast = useToast();
const state = useWebchatSettings();
const form = state.form;
const userStore = useUserStore();
const { getApiUrl } = useDomain();

const status = computed(() =>
  webchatInstallStatus(state.saved.value.isEnabled, state.lastSeenAt.value),
);
const seenHost = computed(() => websiteHost(state.lastSeenOrigin.value));
const seenUrl = computed(() => websiteUrl(state.lastSeenOrigin.value));

const band = computed(() => {
  if (status.value === "live") {
    const since = formatSince(state.lastSeenAt.value!, locale.value);
    return {
      pill: t("webchat.install.working"),
      tone: "bg-[rgb(220,252,231)] text-[rgb(22,101,52)]",
      text: seenHost.value
        ? t("webchat.install.seenOn", { host: seenHost.value, time: since })
        : t("webchat.install.seen", { time: since }),
    };
  }
  if (status.value === "notInstalled") {
    return {
      pill: t("webchat.install.notInstalled"),
      tone: "bg-[rgb(254,243,199)] text-[rgb(120,53,15)]",
      text: t("webchat.install.notInstalledText"),
    };
  }
  return {
    pill: t("webchat.status.off"),
    tone: "bg-neutral-100 text-neutral-500",
    text: t("webchat.install.offText"),
  };
});

const snippet = computed(() =>
  buildWebchatSnippet({
    organizationId: userStore.activeOrganizationId || "YOUR_ORG_ID",
    baseUrl: getApiUrl(),
    widgetTitle: form.value.widgetTitle,
    position: form.value.position,
    isEnabled: form.value.isEnabled,
    showGreeting: form.value.showGreeting,
    greetingMessage: form.value.greetingMessage,
  }),
);

const mailto = computed(
  () =>
    `mailto:?subject=${encodeURIComponent(t("webchat.install.emailSubject"))}&body=${encodeURIComponent(
      `${t("webchat.install.emailBody")}\n\n${snippet.value}\n`,
    )}`,
);

const copied = ref<"snippet" | "secret" | null>(null);
async function copy(text: string, what: "snippet" | "secret") {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    setTimeout(() => {
      if (copied.value === what) copied.value = null;
    }, 2000);
  } catch (error) {
    console.error("Failed to copy:", error);
  }
}

// Customer identity secret (D1): reveal and replace act straight away, never through Save.
const secret = ref<string | null>(null);
const revealing = ref(false);
const rotating = ref(false);
const rotateOpen = ref(false);

async function revealSecret() {
  revealing.value = true;
  try {
    secret.value = (await Hay.webchat.revealIdentitySecret.mutate()).secret;
  } catch (error) {
    console.error("Failed to reveal the identity secret:", error);
    toast.error(t("webchat.install.secretFailed"));
  } finally {
    revealing.value = false;
  }
}

async function rotateSecret() {
  rotating.value = true;
  try {
    secret.value = (await Hay.webchat.rotateIdentitySecret.mutate()).secret;
    rotateOpen.value = false;
    toast.success(t("webchat.install.secretReplaced"));
  } catch (error) {
    console.error("Failed to replace the identity secret:", error);
    toast.error(t("webchat.install.secretFailed"));
  } finally {
    rotating.value = false;
  }
}
</script>
