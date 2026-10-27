<template>
  <div v-if="expiresAtMs !== null" class="mb-2" data-testid="reply-window">
    <p v-if="!closed" class="flex items-center gap-1.5 text-xs text-neutral-muted">
      <Clock class="h-3.5 w-3.5" />
      {{ t("conversations.replyWindow.open", { relative: relativeClose }) }}
    </p>
    <div
      v-else
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      role="status"
    >
      <span class="flex items-start gap-1.5">
        <Clock class="h-4 w-4 mt-0.5 flex-shrink-0" />
        {{ t("conversations.replyWindow.closed") }}
      </span>
      <Button
        v-if="canSend"
        size="sm"
        variant="outline"
        class="flex-shrink-0"
        data-testid="reply-window-send-template"
        @click="openPicker"
      >
        <FileText class="h-4 w-4 mr-2" />
        {{ t("conversations.replyWindow.sendTemplate") }}
      </Button>
    </div>

    <Dialog v-model:open="pickerOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t("conversations.replyWindow.picker.title") }}</DialogTitle>
          <DialogDescription>
            {{ t("conversations.replyWindow.picker.description") }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2 text-left">
          <p v-if="loading" class="text-sm text-neutral-muted">
            {{ t("conversations.replyWindow.picker.loading") }}
          </p>
          <p v-else-if="loadError" class="text-sm text-red-600" role="alert">
            {{ t("conversations.replyWindow.picker.loadFailed") }}
          </p>
          <p v-else-if="!supported" class="text-sm text-neutral-muted">
            {{ t("conversations.replyWindow.picker.unsupported") }}
          </p>
          <p v-else-if="templates.length === 0" class="text-sm text-neutral-muted">
            {{ t("conversations.replyWindow.picker.empty") }}
          </p>
          <template v-else>
            <Input
              v-model="selectedKey"
              type="select"
              :label="t('conversations.replyWindow.picker.template')"
              :options="templateOptions"
            />
            <Input
              v-for="variable in selected?.variables ?? []"
              :key="variable"
              v-model="values[variable]"
              :label="t('conversations.replyWindow.picker.variable', { name: variable })"
            />
            <div v-if="selected" class="space-y-1">
              <p class="text-xs font-medium text-neutral-muted">
                {{ t("conversations.replyWindow.picker.preview") }}
              </p>
              <p class="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm">{{ preview }}</p>
            </div>
          </template>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="pickerOpen = false">
            {{ t("common.cancel") }}
          </Button>
          <Button :disabled="!canSubmit" :loading="sending" @click="send">
            {{ t("conversations.replyWindow.picker.send") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * Reply window state above the composer (D13-2) and the template picker used
 * once it has closed (D13-3). Channel-agnostic: a conversation only has a
 * window when its channel plugin reports one (`reply_window_expires_at`), and
 * the templates come from that plugin through core.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Clock, FileText } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

type ChannelTemplate = RouterOutputs["conversations"]["channelTemplates"]["templates"][number];

const props = defineProps<{
  conversationId: string;
  expiresAt: string | Date | null | undefined;
  /** Whether the current user may send (has taken the conversation over). */
  canSend: boolean;
}>();

const emit = defineEmits<{ "update:closed": [closed: boolean] }>();

const { t, locale } = useI18n();
const toast = useToast();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

const expiresAtMs = computed(() => {
  if (!props.expiresAt) return null;
  const ms = new Date(props.expiresAt).getTime();
  return Number.isNaN(ms) ? null : ms;
});

const closed = computed(() => expiresAtMs.value !== null && now.value >= expiresAtMs.value);
watch(closed, (value) => emit("update:closed", value), { immediate: true });

const relativeClose = computed(() => {
  const minutes = Math.max(1, Math.round(((expiresAtMs.value ?? now.value) - now.value) / 60_000));
  const format = new Intl.RelativeTimeFormat(locale.value, { numeric: "always" });
  return minutes >= 60
    ? format.format(Math.round(minutes / 60), "hour")
    : format.format(minutes, "minute");
});

// --- Template picker ---------------------------------------------------------
const pickerOpen = ref(false);
const loading = ref(false);
const loadError = ref(false);
const supported = ref(true);
const templates = ref<ChannelTemplate[]>([]);
const selectedKey = ref("");
const values = ref<Record<string, string>>({});
const sending = ref(false);

const keyOf = (template: ChannelTemplate) => `${template.name}::${template.language}`;

const templateOptions = computed(() =>
  templates.value.map((template) => ({
    label: `${template.name} (${template.language})`,
    value: keyOf(template),
  })),
);

const selected = computed(() => templates.value.find((tpl) => keyOf(tpl) === selectedKey.value));

const preview = computed(() =>
  (selected.value?.body ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) =>
    values.value[name]?.trim() ? values.value[name] : match,
  ),
);

const canSubmit = computed(
  () =>
    Boolean(selected.value) &&
    !sending.value &&
    (selected.value?.variables ?? []).every((name) => values.value[name]?.trim()),
);

watch(selectedKey, () => {
  values.value = {};
});

const openPicker = async () => {
  pickerOpen.value = true;
  loading.value = true;
  loadError.value = false;
  try {
    const result = await HayApi.conversations.channelTemplates.query({
      conversationId: props.conversationId,
    });
    supported.value = result.supported;
    templates.value = result.templates;
    selectedKey.value = result.templates[0] ? keyOf(result.templates[0]) : "";
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
};

const send = async () => {
  if (!selected.value) return;
  sending.value = true;
  try {
    await HayApi.conversations.sendChannelTemplate.mutate({
      conversationId: props.conversationId,
      name: selected.value.name,
      language: selected.value.language,
      values: values.value,
    });
    pickerOpen.value = false;
    toast.success(t("conversations.replyWindow.picker.sent"));
  } catch (error: unknown) {
    toast.error(
      t("conversations.replyWindow.picker.failed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    sending.value = false;
  }
};
</script>
