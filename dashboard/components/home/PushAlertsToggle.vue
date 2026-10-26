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
  </template>

  <!-- Full: the settings card body -->
  <div v-else class="space-y-4">
    <p class="text-sm text-neutral-muted">{{ $t("home.push.description") }}</p>

    <p
      v-if="push.status.value === 'unsupported'"
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
      <label class="flex items-center gap-3 text-sm font-medium text-foreground">
        <Switch
          :model-value="push.status.value === 'on'"
          :disabled="push.busy.value || push.status.value === 'loading'"
          data-testid="push-switch"
          @update:model-value="toggle"
        />
        {{ push.status.value === "on" ? $t("home.push.statusOn") : $t("home.push.statusOff") }}
      </label>
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
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { Bell, BellRing, Send } from "lucide-vue-next";
import { usePushNotifications } from "@/composables/usePushNotifications";
import { useToast } from "@/composables/useToast";

withDefaults(defineProps<{ variant?: "compact" | "full" }>(), { variant: "compact" });

const push = usePushNotifications();
const toast = useToast();
const router = useRouter();
const { t } = useI18n();

onMounted(() => {
  void push.init();
});

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
