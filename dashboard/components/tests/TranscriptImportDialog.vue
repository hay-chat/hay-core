<template>
  <Dialog :open="open" size="lg" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("tests.import.title") }}</DialogTitle>
        <DialogDescription>{{ $t("tests.import.description") }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <Input
          v-model="format"
          type="select"
          :label="$t('tests.import.format')"
          :options="formatOptions"
        />

        <template v-if="format === 'gorgias'">
          <Input v-model="gorgias.subdomain" :label="$t('tests.import.gorgiasSubdomain')" />
          <Input v-model="gorgias.email" type="email" :label="$t('tests.import.gorgiasEmail')" />
          <Input
            v-model="gorgias.apiKey"
            type="password"
            :label="$t('tests.import.gorgiasApiKey')"
          />
          <p class="text-xs text-muted-foreground">{{ $t("tests.import.gorgiasHelp") }}</p>
        </template>

        <template v-else>
          <Input
            v-if="format === 'whatsapp'"
            v-model="businessName"
            :label="$t('tests.import.businessName')"
          />
          <Input
            v-model="content"
            type="textarea"
            rows="8"
            :label="$t('tests.import.content')"
            :placeholder="format === 'paste' ? $t('tests.import.contentPlaceholder') : ''"
          />
          <label class="block text-sm">
            <span class="mb-1 block text-muted-foreground">{{ $t("tests.import.file") }}</span>
            <input type="file" accept=".csv,.txt" class="text-sm" @change="readFile" />
          </label>
        </template>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ $t("common.cancel") }}
        </Button>
        <Button :loading="importing" :disabled="!canSubmit" @click="submit">
          {{ $t("tests.import.submit") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

/** Import past conversations for replays (D7-8 API): pasted text, exports, or Gorgias. */
const FORMATS = ["paste", "csv", "whatsapp", "tidio", "gorgias"] as const;
type Format = (typeof FORMATS)[number];

defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; imported: [] }>();

const { t } = useI18n();
const toast = useToast();

const format = ref<Format>("paste");
const content = ref("");
const businessName = ref("");
const gorgias = reactive({ subdomain: "", email: "", apiKey: "" });
const importing = ref(false);

const formatOptions = computed(() =>
  FORMATS.map((value) => ({ value, label: t(`tests.import.formats.${value}`) })),
);

const canSubmit = computed(() =>
  format.value === "gorgias"
    ? !!(gorgias.subdomain.trim() && gorgias.email.trim() && gorgias.apiKey.trim())
    : !!content.value.trim(),
);

async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) content.value = await file.text();
}

async function submit() {
  importing.value = true;
  try {
    const result =
      format.value === "gorgias"
        ? await Hay.testTranscripts.importGorgias.mutate({ ...gorgias })
        : await Hay.testTranscripts.importText.mutate({
            format: format.value,
            content: content.value,
            businessName: businessName.value.trim() || undefined,
          });
    toast.success(t("tests.import.done", { count: result.imported }, result.imported));
    content.value = "";
    gorgias.apiKey = "";
    emit("imported");
    emit("update:open", false);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    importing.value = false;
  }
}
</script>
