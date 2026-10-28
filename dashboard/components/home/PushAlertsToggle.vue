<template>
  <!-- Compact: a single button for page headers -->
  <template v-if="variant === 'compact'">
    <Button
      v-if="push.status.value === 'off'"
      variant="outline"
      class="min-h-11 sm:min-h-0"
      :loading="push.busy.value"
      data-testid="push-enable"
      @click="enable"
    >
      <Bell class="mr-2 h-4 w-4" />
      {{ $t("home.push.enable") }}
    </Button>
    <Button
      v-else-if="push.status.value === 'on'"
      variant="ghost"
      class="min-h-11 text-neutral-muted sm:min-h-0"
      :loading="push.busy.value"
      data-testid="push-enabled"
      @click="router.push('/settings/profile')"
    >
      <BellRing class="mr-2 h-4 w-4 text-green-600" />
      {{ $t("home.push.enabled") }}
    </Button>
    <!-- Blocked or unsupported here: the Profile card explains what to do -->
    <Button
      v-else-if="push.status.value === 'denied' || push.status.value === 'unsupported'"
      variant="ghost"
      class="min-h-11 text-neutral-muted sm:min-h-0"
      data-testid="push-blocked"
      @click="router.push('/settings/profile')"
    >
      <BellOff class="mr-2 h-4 w-4" />
      {{ $t("home.push.blocked") }}
    </Button>
  </template>

  <!-- Full: the settings card body -->
  <div v-else class="space-y-4">
    <p class="text-sm text-neutral-muted">{{ $t("home.push.description") }}</p>

    <!-- iPhone in a browser tab: alerts need the Home Screen app first -->
    <InstallAppGuide v-if="push.status.value === 'unsupported' && iosInstall" />
    <p
      v-else-if="push.status.value === 'unsupported'"
      class="rounded-lg bg-background-tertiary p-3 text-sm text-neutral-700"
    >
      {{ $t("home.push.unsupported") }}
    </p>
    <p
      v-else-if="push.status.value === 'unavailable'"
      class="rounded-lg bg-background-tertiary p-3 text-sm text-neutral-700"
    >
      {{ $t("home.push.unavailable") }}
    </p>
    <p
      v-else-if="push.status.value === 'denied'"
      class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
    >
      {{ $t("home.push.denied") }}
    </p>

    <div v-else class="flex flex-wrap items-center justify-between gap-3">
      <Input
        type="switch"
        :label="push.status.value === 'on' ? $t('home.push.statusOn') : $t('home.push.statusOff')"
        :model-value="push.status.value === 'on'"
        :disabled="push.busy.value || push.status.value === 'loading'"
        data-testid="push-switch"
        @update:model-value="toggle($event === true)"
      />
      <Button
        v-if="push.status.value === 'on'"
        variant="outline"
        size="sm"
        :loading="push.busy.value"
        data-testid="push-send-test"
        @click="sendTest"
      >
        <Send class="mr-2 h-4 w-4" />
        {{ $t("home.push.sendTest") }}
      </Button>
    </div>

    <p v-if="push.error.value" class="text-sm text-destructive">{{ push.error.value }}</p>

    <!-- Lock-screen privacy (D11-12): per person, applies to every device -->
    <div class="space-y-1 border-t border-border pt-4">
      <Input
        type="switch"
        :label="$t('home.push.privacyLabel')"
        :model-value="hidePreview === true"
        :disabled="privacyBusy || hidePreview === null"
        data-testid="push-privacy-switch"
        @update:model-value="setPrivacy($event === true)"
      />
      <p class="text-sm text-neutral-muted">{{ $t("home.push.privacyHelp") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Bell, BellRing, BellOff, Send } from "lucide-vue-next";
import { usePushNotifications } from "@/composables/usePushNotifications";
import { useToast } from "@/composables/useToast";
import { browserNeedsIosInstall } from "@/utils/install-app";
import { Hay } from "@/utils/api";

const props = withDefaults(defineProps<{ variant?: "compact" | "full" }>(), {
  variant: "compact",
});

const push = usePushNotifications();
const toast = useToast();
const router = useRouter();
const { t } = useI18n();

const iosInstall = ref(false);
const hidePreview = ref<boolean | null>(null);
const privacyBusy = ref(false);

onMounted(() => {
  void push.init();
  iosInstall.value = browserNeedsIosInstall();
  if (props.variant === "full") void loadPrivacy();
});

const loadPrivacy = async () => {
  try {
    hidePreview.value = (await Hay.notifications.alertPrivacy.query()).hidePreview;
  } catch (error) {
    console.error("[PushAlerts] privacy setting failed to load:", error);
  }
};

const setPrivacy = async (value: boolean) => {
  privacyBusy.value = true;
  try {
    hidePreview.value = (
      await Hay.notifications.setAlertPrivacy.mutate({ hidePreview: value })
    ).hidePreview;
    toast.success(value ? t("home.push.privacyOn") : t("home.push.privacyOff"));
  } catch {
    toast.error(t("home.push.privacyFailed"));
  } finally {
    privacyBusy.value = false;
  }
};

const enable = async () => {
  const ok = await push.enable();
  if (!ok && push.status.value !== "denied") {
    toast.error(t("home.push.failed"), push.error.value ?? undefined);
  }
};

const toggle = async (checked: boolean) => {
  if (checked) {
    await enable();
  } else {
    await push.disable();
  }
};

const sendTest = async () => {
  const result = await push.sendTest();
  if (!result) return;
  if (result.sent > 0) {
    toast.success(t("home.push.testSent"), t("home.push.testSentBody"));
  } else {
    toast.warning(t("home.push.testNone"));
  }
};
</script>
