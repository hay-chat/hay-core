<template>
  <Page :title="$t('assistant.page.title')" :description="$t('assistant.page.description')">
    <SettingsTabs />

    <div v-if="loading" class="text-center py-12">
      <Loading :label="$t('assistant.page.loading')" />
    </div>

    <form v-else data-testid="assistant-form" class="space-y-6" @submit.prevent="handleSubmit">
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("assistant.form.cardTitle") }}</CardTitle>
          <CardDescription>{{ $t("assistant.form.cardDescription") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
          <Input
            id="name"
            v-model="form.name"
            :label="$t('assistant.form.name.label')"
            :placeholder="
              $t('assistant.form.name.placeholder', {
                organization: organizationStore.current?.name ?? '',
              })
            "
            :class="errors.name ? 'border-red-500' : ''"
            :helper-text="errors.name || $t('assistant.form.name.helperText')"
          />
          <Input
            id="description"
            v-model="form.description"
            type="textarea"
            :label="$t('assistant.form.description.label')"
            :helper-text="$t('assistant.form.description.helperText')"
            :placeholder="$t('assistant.form.description.placeholder')"
          />
          <InstructionsTiptap
            ref="instructionsEditorRef"
            :initial-data="form.instructions"
            :label="$t('assistant.form.instructions.label')"
            :hint="$t('assistant.form.instructions.hint')"
          />
          <Input
            id="initialGreeting"
            v-model="form.initialGreeting"
            type="textarea"
            :label="$t('assistant.form.initialGreeting.label')"
            :helper-text="$t('assistant.form.initialGreeting.helperText')"
            :placeholder="$t('assistant.form.initialGreeting.placeholder')"
          />
          <div>
            <Label>{{ $t("assistant.form.tone.label") }}</Label>
            <div class="gap-4 mb-4 mt-2 grid grid-cols-3">
              <OptionCard
                v-for="preset in TONE_PRESETS"
                :key="preset"
                :image="`/bale/${preset}.svg`"
                :label="$t(`assistant.form.tone.${preset}`)"
                :checked="form.tone === tonePresetText(preset)"
                @click="form.tone = tonePresetText(preset)"
              />
            </div>
            <Input
              id="tone"
              v-model="form.tone"
              type="textarea"
              :placeholder="$t('assistant.form.tone.placeholder')"
            />
          </div>
          <Input
            id="avoid"
            v-model="form.avoid"
            type="textarea"
            :label="$t('assistant.form.avoid.label')"
            :placeholder="$t('assistant.form.avoid.placeholder')"
          />
          <p class="text-sm text-neutral-muted">{{ $t("assistant.form.languageNote") }}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ $t("assistant.escalation.title") }}</CardTitle>
          <CardDescription>{{ $t("assistant.escalation.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
          <InstructionsTiptap
            ref="handoffAvailableEditorRef"
            :initial-data="form.humanHandoffAvailableInstructions"
            :label="$t('assistant.escalation.availableLabel')"
            :hint="$t('assistant.escalation.availableHint')"
          />

          <HandoffTicketSettings v-model="form.humanHandoffUnavailableTicket" />

          <!-- v-show, not v-if: the editor must stay mounted so save() keeps the text when a ticket is chosen. -->
          <InstructionsTiptap
            v-show="!form.humanHandoffUnavailableTicket"
            ref="handoffUnavailableEditorRef"
            :initial-data="form.humanHandoffUnavailableInstructions"
            :hint="$t('assistant.escalation.unavailableHint')"
          />
        </CardContent>
      </Card>

      <div class="flex justify-end space-x-4">
        <Button type="button" variant="outline" :disabled="isSubmitting" @click="resetForm">
          {{ $t("assistant.actions.cancel") }}
        </Button>
        <Button type="submit" :loading="isSubmitting">
          {{ $t("assistant.actions.save") }}
        </Button>
      </div>
    </form>

    <!-- Unsaved Changes Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :description="confirmDialogConfig.description"
      :confirm-text="$t('assistant.page.leavePage')"
      :destructive="true"
      @confirm="confirmDialogConfig.onConfirm"
      @cancel="handleDialogCancel"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import type { JSONContent } from "@tiptap/vue-3";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";
import { useToast } from "~/composables/useToast";
import { useUnsavedChanges } from "~/composables/useUnsavedChanges";
import { useOrganizationStore } from "~/stores/organization";
import { Hay } from "@/utils/api";

/**
 * The organization's AI assistant (one per organization): identity, tone,
 * standing instructions and what it does on a hand-off. Playbooks hold the
 * per-situation steps and all of them apply.
 */
type Assistant = RouterOutputs["organizations"]["assistant"]["get"];
type InstructionsInput = NonNullable<
  RouterInputs["organizations"]["assistant"]["update"]["instructions"]
>;
type HandoffTicket = Assistant["humanHandoffUnavailableTicket"];

const TONE_PRESETS = ["professional", "casual", "enthusiastic"] as const;
type TonePreset = (typeof TONE_PRESETS)[number];

const EMPTY_INSTRUCTIONS: JSONContent = { type: "doc", content: [] };

// Stored instruction data (jsonb) is opaque; coerce a non-null object into editor JSON content.
const toInstructionContent = (value: unknown): JSONContent =>
  value && typeof value === "object" ? (value as JSONContent) : EMPTY_INSTRUCTIONS;

// Tiptap's JSONContent types `type` as an optional string; the API wants a document
// envelope. Anything else (an untouched editor) becomes an empty document.
const toInstructionsInput = (value: JSONContent | null | undefined): InstructionsInput =>
  (value?.type === "doc" ? value : EMPTY_INSTRUCTIONS) as InstructionsInput;

const { t } = useI18n();
const toast = useToast();
const organizationStore = useOrganizationStore();

const emptyForm = () => ({
  name: "",
  description: "",
  instructions: EMPTY_INSTRUCTIONS,
  initialGreeting: "",
  tone: "",
  avoid: "",
  humanHandoffAvailableInstructions: EMPTY_INSTRUCTIONS,
  humanHandoffUnavailableInstructions: EMPTY_INSTRUCTIONS,
  humanHandoffUnavailableTicket: null as HandoffTicket,
});

const form = ref(emptyForm());
const initialForm = ref(emptyForm());
const loading = ref(true);
const isSubmitting = ref(false);
const errors = ref<Record<string, string>>({});

// Editor refs. The Tiptap editor exposes a synchronous save() returning JSON content.
type EditorRef = { save: () => JSONContent | null } | null;
const instructionsEditorRef = ref<EditorRef>(null);
const handoffAvailableEditorRef = ref<EditorRef>(null);
const handoffUnavailableEditorRef = ref<EditorRef>(null);

const tonePresetText = (preset: TonePreset) => t(`assistant.form.tone.presets.${preset}`);

const { markAsSaved, showConfirmDialog, confirmDialogConfig, handleDialogCancel } =
  useUnsavedChanges(
    initialForm,
    form,
    computed(() => !loading.value && !isSubmitting.value),
  );

const fromAssistant = (assistant: Assistant) => ({
  name: assistant.name ?? "",
  description: assistant.description ?? "",
  instructions: toInstructionContent(assistant.instructions),
  initialGreeting: assistant.initialGreeting ?? "",
  tone: assistant.tone ?? "",
  avoid: assistant.avoid ?? "",
  humanHandoffAvailableInstructions: toInstructionContent(
    assistant.humanHandoffAvailableInstructions,
  ),
  humanHandoffUnavailableInstructions: toInstructionContent(
    assistant.humanHandoffUnavailableInstructions,
  ),
  humanHandoffUnavailableTicket: assistant.humanHandoffUnavailableTicket ?? null,
});

const applyAssistant = (assistant: Assistant) => {
  const data = fromAssistant(assistant);
  form.value = data;
  initialForm.value = JSON.parse(JSON.stringify(data));
};

onMounted(async () => {
  try {
    applyAssistant(await Hay.organizations.assistant.get.query());
  } catch (error) {
    console.error("Failed to load assistant:", error);
    toast.error(t("assistant.toast.loadFailed"));
  } finally {
    loading.value = false;
  }
});

const resetForm = async () => {
  // Remount the editors with the saved content.
  loading.value = true;
  form.value = JSON.parse(JSON.stringify(initialForm.value));
  await nextTick();
  loading.value = false;
};

const handleSubmit = async () => {
  errors.value = {};
  if (form.value.name.length > 255) {
    errors.value.name = t("assistant.form.name.tooLong");
    return;
  }

  try {
    isSubmitting.value = true;
    const saved = await Hay.organizations.assistant.update.mutate({
      name: form.value.name,
      description: form.value.description,
      instructions: toInstructionsInput(instructionsEditorRef.value?.save()),
      initialGreeting: form.value.initialGreeting,
      tone: form.value.tone,
      avoid: form.value.avoid,
      humanHandoffAvailableInstructions: toInstructionsInput(
        handoffAvailableEditorRef.value?.save(),
      ),
      humanHandoffUnavailableInstructions: toInstructionsInput(
        handoffUnavailableEditorRef.value?.save(),
      ),
      humanHandoffUnavailableTicket: form.value.humanHandoffUnavailableTicket ?? null,
    });
    applyAssistant(saved);
    markAsSaved();
    toast.success(t("assistant.toast.updatedSuccess"));
  } catch (error) {
    console.error("Failed to save assistant:", error);
    // Surface the server's message: a bare "please try again" gives nothing to act on.
    toast.error(
      t("assistant.toast.updateFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    isSubmitting.value = false;
  }
};

definePageMeta({
  layout: "default",
});

useHead({
  title: computed(() => t("assistant.page.metaTitle")),
  meta: [{ name: "description", content: computed(() => t("assistant.page.metaDescription")) }],
});
</script>
