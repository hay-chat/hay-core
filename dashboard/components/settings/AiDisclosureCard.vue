<template>
  <!-- AI on each channel: the AI label (D14-6) and send automatically, drafts only (D14-7) or off (D7-14). -->
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
        <p class="text-sm text-muted-foreground">{{ $t("customerPrivacy.aiLabel.draftsHint") }}</p>
        <p class="text-sm text-muted-foreground">{{ $t("customerPrivacy.aiLabel.offHint") }}</p>
        <Button
          v-if="channels.length > 1"
          variant="outline"
          size="sm"
          data-testid="start-web-chat-only"
          @click="startOnWebChatOnly"
        >
          {{ $t("customerPrivacy.aiLabel.webChatOnly") }}
        </Button>
        <div
          v-for="ch in channels"
          :key="ch.channel"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <span class="text-sm font-medium">{{ ch.name }}</span>
          <div class="flex flex-wrap items-center gap-4">
            <Input
              :model-value="modes[ch.channel] ?? 'on'"
              type="select"
              :aria-label="`${ch.name}: ${$t('customerPrivacy.aiLabel.aiReplies')}`"
              :options="modeOptions"
              @update:model-value="setMode(ch.channel, $event as ChannelAiMode)"
            />
            <Input
              :model-value="!hiddenChannels.includes(ch.channel)"
              type="switch"
              :label="$t('customerPrivacy.aiLabel.showLabel')"
              :disabled="locked"
              @update:model-value="setShown(ch.channel, $event)"
            />
          </div>
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
type ChannelAiMode = "on" | "drafts" | "off";
// Channel id -> mode; a missing channel is "on".
const modes = ref<Record<string, ChannelAiMode>>({});
const locked = ref(false);

// Web Chat plus every enabled channel plugin, keyed by channel id (never plugin id).
const channels = computed(() => [
  { channel: "web", name: t("customerPrivacy.aiLabel.webChat") },
  ...appStore.plugins
    .filter((p) => p.enabled && p.type?.includes("channel") && p.channel)
    .map((p) => ({ channel: p.channel as string, name: p.name })),
]);

const modeOptions = computed(() => [
  { label: t("customerPrivacy.aiLabel.modeOn"), value: "on" },
  { label: t("customerPrivacy.aiLabel.modeDrafts"), value: "drafts" },
  { label: t("customerPrivacy.aiLabel.modeOff"), value: "off" },
]);

function setMode(channel: string, mode: ChannelAiMode) {
  const next = { ...modes.value };
  if (mode === "on") delete next[channel];
  else next[channel] = mode;
  modes.value = next;
}

// Go live on one channel first (D7-14): the AI keeps Web Chat as it is and
// stops answering on every other channel until the team switches it back on.
function startOnWebChatOnly() {
  for (const ch of channels.value) {
    if (ch.channel !== "web") setMode(ch.channel, "off");
  }
  toast.info(t("customerPrivacy.aiLabel.webChatOnlyDone"));
}

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
    modes.value = { ...result.channelAiModes };
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
      channelAiModes: modes.value,
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
