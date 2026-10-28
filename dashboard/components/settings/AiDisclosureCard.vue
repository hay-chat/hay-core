<template>
  <!-- AI label on AI replies (D14-6): widget badge, first-reply line on other channels. -->
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("customerPrivacy.aiLabel.title") }}</CardTitle>
      <CardDescription>{{ $t("customerPrivacy.aiLabel.description") }}</CardDescription>
    </CardHeader>
    <CardContent v-if="loaded" class="space-y-6">
      <Input
        v-model="label"
        :label="$t('customerPrivacy.aiLabel.labelText')"
        :placeholder="$t('customerPrivacy.aiLabel.labelPlaceholder')"
        :hint="$t('customerPrivacy.aiLabel.labelHint')"
        :character-limit="AI_LABEL_MAX_LENGTH"
      />

      <Alert v-if="locked">
        <AlertTitle>{{ $t("customerPrivacy.aiLabel.lockedTitle") }}</AlertTitle>
        <AlertDescription>{{ $t("customerPrivacy.aiLabel.lockedDescription") }}</AlertDescription>
      </Alert>

      <div class="space-y-3">
        <p class="text-sm font-medium">{{ $t("customerPrivacy.aiLabel.channelsTitle") }}</p>
        <div
          v-for="ch in channels"
          :key="ch.channel"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <span class="text-sm font-medium">{{ ch.name }}</span>
          <Input
            :model-value="!hiddenChannels.includes(ch.channel)"
            type="switch"
            :label="$t('customerPrivacy.aiLabel.showLabel')"
            :disabled="locked"
            @update:model-value="setShown(ch.channel, $event)"
          />
        </div>
      </div>

      <Button :loading="isSaving" @click="save">
        {{ $t("customerPrivacy.aiLabel.save") }}
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useAppStore } from "@/stores/app";
import { useToast } from "@/composables/useToast";

// Mirrors server/services/ai-disclosure.ts AI_LABEL_MAX_LENGTH.
const AI_LABEL_MAX_LENGTH = 40;

const { t } = useI18n();
const toast = useToast();
const appStore = useAppStore();

const loaded = ref(false);
const isSaving = ref(false);
const label = ref("");
const hiddenChannels = ref<string[]>([]);
const locked = ref(false);

// Web Chat plus every enabled channel plugin, keyed by channel id (never plugin id).
const channels = computed(() => [
  { channel: "web", name: t("customerPrivacy.aiLabel.webChat") },
  ...appStore.plugins
    .filter((p) => p.enabled && p.type?.includes("channel") && p.channel)
    .map((p) => ({ channel: p.channel as string, name: p.name })),
]);

function setShown(channel: string, shown: string | number | boolean) {
  const set = new Set(hiddenChannels.value);
  if (shown) set.delete(channel);
  else set.add(channel);
  hiddenChannels.value = [...set];
}

async function load() {
  try {
    const result = await Hay.organizations.getAiDisclosure.query();
    label.value = result.label ?? "";
    hiddenChannels.value = result.hiddenChannels;
    locked.value = result.locked;
    loaded.value = true;
  } catch (error) {
    console.error("Failed to load AI label settings:", error);
    toast.error(t("customerPrivacy.aiLabel.loadFailed"));
  }
}

async function save() {
  isSaving.value = true;
  try {
    await Hay.organizations.updateAiDisclosure.mutate({
      label: label.value.trim() || null,
      ...(locked.value ? {} : { hiddenChannels: hiddenChannels.value }),
    });
    toast.success(t("customerPrivacy.aiLabel.saveSuccess"));
  } catch (error) {
    console.error("Failed to save AI label settings:", error);
    toast.error(t("customerPrivacy.aiLabel.saveFailed"));
  } finally {
    isSaving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), appStore.plugins.length ? undefined : appStore.fetchPlugins()]);
});
</script>
