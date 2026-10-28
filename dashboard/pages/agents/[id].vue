<template>
  <Page :title="$t('agents.page.title')" :description="$t('agents.page.description')" width="max">
    <template #header>
      <Button v-if="isEditMode" variant="ghost" @click="() => router.push('/agents')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ $t("agents.page.backToList") }}
      </Button>
    </template>

    <div v-if="loading" class="text-center py-12">
      <Loading :label="$t('agents.page.loading')" />
    </div>

    <template v-else-if="!isEditMode || agent">
      <form data-testid="agent-form" class="space-y-6" @submit.prevent="handleSubmit">
        <Card>
          <CardHeader>
            <CardTitle>{{ $t("agents.form.cardTitle") }}</CardTitle>
            <CardDescription>{{ $t("agents.form.cardDescription") }}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Name Field -->
            <Input
              id="name"
              v-model="form.name"
              :label="$t('agents.form.name.label')"
              :placeholder="$t('agents.form.name.placeholder')"
              :class="errors.name ? 'border-red-500' : ''"
              :helper-text="errors.name"
              required
            />
            <!-- Description Field -->
            <Input
              id="description"
              v-model="form.description"
              type="textarea"
              :label="$t('agents.form.description.label')"
              :helper-text="$t('agents.form.description.helperText')"
              :placeholder="$t('agents.form.description.placeholder')"
            />
            <!-- Instructions Field -->
            <InstructionsTiptap
              ref="instructionsEditorRef"
              :initial-data="form.instructions"
              :label="$t('agents.form.instructions.label')"
              :hint="$t('agents.form.instructions.hint')"
              :error="errors.instructions"
            />
            <!-- Initial Greeting Field -->
            <Input
              id="initialGreeting"
              v-model="form.initialGreeting"
              type="textarea"
              :label="$t('agents.form.initialGreeting.label')"
              :helper-text="$t('agents.form.initialGreeting.helperText')"
              :placeholder="$t('agents.form.initialGreeting.placeholder')"
            />
            <!-- Language Field -->
            <Input
              id="language"
              v-model="form.language"
              type="select"
              :label="$t('agents.language.label')"
              :options="languageOptions"
              :helper-text="$t('agents.language.helperText')"
            />
            <!-- Tone Field -->
            <div>
              <Label>{{ $t("agents.form.tone.label") }}</Label>
              <div class="gap-4 mb-4 mt-2 grid grid-cols-3">
                <OptionCard
                  :image="'/bale/professional.svg'"
                  :label="$t('agents.form.tone.professional')"
                  :checked="selectedTone === 'professional'"
                  @click="setTone('professional')"
                />
                <OptionCard
                  :image="'/bale/casual.svg'"
                  :label="$t('agents.form.tone.casual')"
                  :checked="selectedTone === 'casual'"
                  @click="setTone('casual')"
                />
                <OptionCard
                  :image="'/bale/enthusiastic.svg'"
                  :label="$t('agents.form.tone.enthusiastic')"
                  :checked="selectedTone === 'enthusiastic'"
                  @click="setTone('enthusiastic')"
                />
              </div>
              <Input
                id="tone"
                v-model="form.tone"
                type="textarea"
                :placeholder="$t('agents.form.tone.placeholder')"
              />
            </div>
            <!-- Things to Avoid Field -->
            <Input
              id="avoid"
              v-model="form.avoid"
              type="textarea"
              :label="$t('agents.form.avoid.label')"
              :placeholder="$t('agents.form.avoid.placeholder')"
            />
            <!-- Trigger Field -->
            <Input
              id="trigger"
              v-model="form.trigger"
              type="textarea"
              :label="$t('agents.form.trigger.label')"
              :placeholder="$t('agents.form.trigger.placeholder')"
            />
            <!-- Enabled Field -->
            <div class="space-y-2">
              <div class="flex items-center space-x-2">
                <Input
                  id="enabled"
                  v-model="form.enabled"
                  type="switch"
                  :label="$t('agents.enabled.label')"
                  :helper-text="$t('agents.enabled.helperText')"
                />
              </div>
            </div>

            <!-- Metadata (only in edit mode) -->
            <div v-if="isEditMode && agent" class="space-y-2 text-sm text-neutral-muted">
              <div v-if="agent.created_at">
                {{ $t("agents.form.createdAt", { date: formatDateTime(agent.created_at) }) }}
              </div>
              <div v-if="agent.updated_at">
                {{ $t("agents.form.updatedAt", { date: formatDateTime(agent.updated_at) }) }}
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Channels Field (only shown when the org has at least one channel) -->
        <Card v-if="availableChannels.length > 0">
          <CardHeader>
            <CardTitle>{{ $t("agents.channels.title") }}</CardTitle>
            <CardDescription>{{ $t("agents.sharedChannel.description") }}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div
              v-for="ch in availableChannels"
              :key="ch.channel"
              class="flex items-center space-x-3"
            >
              <div
                class="w-9 h-9 rounded-lg overflow-hidden bg-neutral-muted flex items-center justify-center shrink-0"
              >
                <img
                  v-if="ch.thumbnail"
                  :src="ch.thumbnail"
                  :alt="`${ch.name} icon`"
                  class="w-full h-full object-cover"
                  @error="handleChannelIconError($event)"
                />
                <Radio class="h-5 w-5 text-neutral-muted" :class="ch.thumbnail ? 'hidden' : ''" />
              </div>
              <Input
                :id="`channel-${ch.channel}`"
                :model-value="form.channels.includes(ch.channel)"
                type="switch"
                :label="ch.name"
                @update:model-value="toggleChannel(ch.channel, $event)"
              />
            </div>
            <p
              v-for="note in sharedChannelNotes"
              :key="note.channel"
              class="text-sm text-neutral-muted"
              data-testid="shared-channel-note"
            >
              {{ note.text }}
            </p>
          </CardContent>
        </Card>

        <!-- Message Approval Field -->
        <Card>
          <CardHeader>
            <CardTitle>{{ $t("agents.approval.title") }}</CardTitle>
            <CardDescription>{{ $t("agents.approval.description") }}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Message Approval Field -->
            <div class="space-y-2">
              <div class="gap-4 grid grid-cols-3">
                <OptionCard
                  :label="$t('agents.approval.inherit')"
                  :icon="CornerDownRight"
                  :checked="form.testMode === null"
                  @click="setTestMode(null)"
                />
                <OptionCard
                  :label="$t('agents.approval.require')"
                  :icon="Hand"
                  :checked="form.testMode === true"
                  @click="setTestMode(true)"
                />
                <OptionCard
                  :label="$t('agents.approval.autoSend')"
                  :icon="FastForward"
                  :checked="form.testMode === false"
                  @click="setTestMode(false)"
                />
              </div>
              <p class="text-sm text-neutral-muted mt-2">
                {{ $t("agents.approval.playgroundNote") }}
              </p>
            </div>
          </CardContent>
        </Card>

        <ReadinessCard v-if="isEditMode && agentId" :agent-id="agentId" />

        <Card>
          <CardHeader>
            <CardTitle>{{ $t("agents.escalation.title") }}</CardTitle>
            <CardDescription>{{ $t("agents.escalation.description") }}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <InstructionsTiptap
              ref="handoffAvailableEditorRef"
              :initial-data="form.humanHandoffAvailableInstructions"
              :label="$t('agents.escalation.availableLabel')"
              :hint="$t('agents.escalation.availableHint')"
            />

            <InstructionsTiptap
              ref="handoffUnavailableEditorRef"
              :initial-data="form.humanHandoffUnavailableInstructions"
              :label="$t('agents.escalation.unavailableLabel')"
              :hint="$t('agents.escalation.unavailableHint')"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <!-- Form Actions -->
            <div class="flex justify-between">
              <Button
                v-if="isEditMode"
                type="button"
                variant="destructive"
                :loading="isSubmitting"
                @click="handleDelete"
              >
                <Trash2 class="h-4 w-4 mr-2" />
                {{ $t("agents.actions.delete") }}
              </Button>
              <div :class="isEditMode ? '' : 'w-full'" class="flex justify-end space-x-4">
                <Button
                  v-if="isEditMode && !isDefaultAgent"
                  type="button"
                  variant="outline"
                  :disabled="isSubmitting || settingAsDefault"
                  :loading="settingAsDefault"
                  @click="setAsDefaultAgent"
                >
                  <Star class="h-4 w-4 mr-2" />
                  {{ $t("agents.actions.setAsDefault") }}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  :disabled="isSubmitting"
                  @click="handleCancel"
                >
                  {{ $t("agents.actions.cancel") }}
                </Button>
                <Button type="submit" :loading="isSubmitting" :disabled="!form.name">
                  {{ isEditMode ? $t("agents.actions.save") : $t("agents.actions.create") }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </template>

    <div v-else-if="isEditMode && !loading" class="text-center py-12">
      <Error :label="$t('agents.toast.notFound')" />
    </div>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-if="isEditMode"
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :confirm-text="$t('agents.deleteDialog.confirm')"
      :destructive="true"
      @confirm="confirmDelete"
    />

    <!-- Unsaved Changes Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :description="confirmDialogConfig.description"
      :confirm-text="$t('agents.page.leavePage')"
      :destructive="true"
      @confirm="confirmDialogConfig.onConfirm"
      @cancel="handleDialogCancel"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import type { JSONContent } from "@tiptap/vue-3";
import {
  ArrowLeft,
  Trash2,
  Star,
  FastForward,
  Hand,
  CornerDownRight,
  Radio,
} from "lucide-vue-next";
import type { Agent } from "~/types/playbook";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";
import { useToast } from "~/composables/useToast";
import { useUnsavedChanges } from "~/composables/useUnsavedChanges";
import { HayApi, Hay } from "@/utils/api";
import { useOrganizationStore } from "~/stores/organization";
import { useAppStore } from "@/stores/app";
import { useDomain } from "@/composables/useDomain";

// Editor instruction blocks are stored as Tiptap JSON content.
type InstructionContent = JSONContent | null;
// The agent select returns a language code that maps to the create-agent input shape.
type AgentLanguage = RouterInputs["agents"]["create"]["language"];
// Organization settings include the default agent id (not present on the store type).
type OrganizationSettings = RouterOutputs["organizations"]["getSettings"];

// The create-agent input shape for the non-nullable handoff instruction fields (jsonb columns).
// Excludes null so the result also satisfies the nullable `instructions` slot.
type InstructionsInput = NonNullable<
  RouterInputs["agents"]["create"]["humanHandoffAvailableInstructions"]
>;

const EMPTY_INSTRUCTIONS: JSONContent = { type: "doc", content: [] };

// Stored instruction data (jsonb) is opaque; coerce a non-null object into editor JSON content.
const toInstructionContent = (value: unknown): JSONContent =>
  value && typeof value === "object" ? (value as JSONContent) : EMPTY_INSTRUCTIONS;

// Editor JSON content is persisted verbatim into the jsonb instructions column, which the
// API types as a Tiptap document (`{ type: "doc", ... }`). Tiptap's own JSONContent types
// `type` as an optional string, so narrow it here: anything that is not a document envelope
// (an untouched editor, legacy Editor.js `{ blocks: [] }` data) becomes an empty document
// rather than a payload the server rejects.
const toInstructionsInput = (value: JSONContent | null | undefined): InstructionsInput =>
  (value?.type === "doc" ? value : EMPTY_INSTRUCTIONS) as InstructionsInput;

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { t } = useI18n();
const organizationStore = useOrganizationStore();
const appStore = useAppStore();
const { getApiUrl } = useDomain();
const { formatDateTime } = useOrgDateTime();
const loadingInstructions = ref(false);
const settingAsDefault = ref(false);

// Track initial form state for unsaved changes detection
const initialForm = ref({
  name: "",
  description: "",
  instructions: null as InstructionContent,
  tone: "",
  avoid: "",
  trigger: "",
  enabled: true,
  testMode: null as boolean | null,
  language: "",
  channels: [] as string[],
  humanHandoffAvailableInstructions: null as InstructionContent,
  humanHandoffUnavailableInstructions: null as InstructionContent,
});

// Determine if we're in edit mode based on route
const isEditMode = computed(() => {
  const id = route.params.id;
  const idValue = Array.isArray(id) ? id[0] : id;
  return idValue !== "new";
});

const agentId = computed(() => {
  const id = route.params.id;
  const idValue = Array.isArray(id) ? id[0] : id;
  return idValue === "new" ? null : idValue;
});

// Tone presets, written into the editable Tone field in the dashboard's language.
const tonePresets = computed(() => ({
  professional: t("agents.form.tone.presets.professional"),
  casual: t("agents.form.tone.presets.casual"),
  enthusiastic: t("agents.form.tone.presets.enthusiastic"),
}));

// Language options for the agent language select
// null = inherit from organization (shown as first option)
const languageOptions = [
  { label: t("agents.language.placeholder"), value: "" },
  { label: "English", value: "en" },
  { label: "Português", value: "pt" },
  { label: "Español", value: "es" },
  { label: "Français", value: "fr" },
  { label: "Deutsch", value: "de" },
  { label: "Italiano", value: "it" },
  { label: "Nederlands", value: "nl" },
  { label: "日本語", value: "ja" },
  { label: "中文", value: "zh" },
  { label: "한국어", value: "ko" },
  { label: "العربية", value: "ar" },
  { label: "Türkçe", value: "tr" },
  { label: "Polski", value: "pl" },
  { label: "Русский", value: "ru" },
];

// Form state
const form = ref({
  name: "",
  description: "",
  instructions: { blocks: [] } as JSONContent,
  initialGreeting: "",
  tone: "",
  avoid: "",
  trigger: "",
  enabled: true,
  testMode: null as boolean | null,
  language: "",
  channels: [] as string[],
  humanHandoffAvailableInstructions: { blocks: [] } as JSONContent,
  humanHandoffUnavailableInstructions: { blocks: [] } as JSONContent,
});

// UI state
const loading = ref(false);
const isSubmitting = ref(false);
const agent = ref<Agent | null>(null);
const errors = ref<Record<string, string>>({});

// Editor refs. The Tiptap editor exposes a synchronous save() returning JSON content.
const instructionsEditorRef = ref<{ save: () => InstructionContent } | null>(null);
const handoffAvailableEditorRef = ref<{ save: () => InstructionContent } | null>(null);
const handoffUnavailableEditorRef = ref<{ save: () => InstructionContent } | null>(null);
const selectedTone = ref<string | null>(null);

// Channels the agent can be assigned to: enabled channel plugins + the built-in
// Web Chat channel. The Channels card is hidden when this list is empty.
const availableChannels = computed(() => {
  const pluginChannels = appStore.plugins
    .filter((p) => p.enabled && p.type?.includes("channel") && p.channel)
    .map((p) => ({
      channel: p.channel as string,
      name: p.name,
      thumbnail: getApiUrl(`/plugins/thumbnails/${encodeURIComponent(p.id)}`),
    }));

  return [{ channel: "web", name: t("agents.channels.webChat"), thumbnail: "" }, ...pluginChannels];
});

// Channels this agent shares with other agents, and who answers there (D7-14).
const sharedChannelList = ref<RouterOutputs["agents"]["sharedChannels"]>([]);
const sharedChannelNotes = computed(() =>
  sharedChannelList.value
    .filter((shared) => agentId.value && shared.agentIds.includes(agentId.value))
    .map((shared) => ({
      channel: shared.channel,
      text: t("agents.sharedChannel.note", {
        channel:
          availableChannels.value.find((ch) => ch.channel === shared.channel)?.name ??
          shared.channel,
        agents: shared.agents
          .filter((a) => a.id !== agentId.value)
          .map((a) => a.name)
          .join(", "),
        responder: shared.responderName ?? t("agents.sharedChannel.noResponder"),
      }),
    })),
);

const toggleChannel = (channel: string, enabled: string | number | boolean) => {
  const set = new Set(form.value.channels);
  if (enabled) {
    set.add(channel);
  } else {
    set.delete(channel);
  }
  form.value.channels = [...set];
};

const handleChannelIconError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  const fallback = img.nextElementSibling as HTMLElement | null;
  img.style.display = "none";
  if (fallback) fallback.classList.remove("hidden");
};

// Check if this agent is the default agent for the organization
const isDefaultAgent = computed(() => {
  if (!agent.value || !organizationStore.current) return false;
  const current = organizationStore.current as Partial<OrganizationSettings>;
  return current.defaultAgentId === agent.value.id;
});

// Unsaved changes detection
const {
  hasUnsavedChanges: _hasUnsavedChanges,
  confirmNavigation,
  markAsSaved,
  showConfirmDialog,
  confirmDialogConfig,
  handleDialogCancel,
} = useUnsavedChanges(
  initialForm,
  form,
  computed(() => !loading.value && !isSubmitting.value),
);

// Load data on mount
onMounted(async () => {
  try {
    // Load enabled plugins so the Channels card can list channel plugins.
    await appStore.fetchPlugins();

    // Load agent if in edit mode
    if (isEditMode.value && agentId.value) {
      loading.value = true;
      loadingInstructions.value = true;
      const agentResponse = await HayApi.agents.get.query({
        id: agentId.value,
      });

      if (!agentResponse) {
        toast.error(t("agents.toast.notFound"));
        await router.push("/agents");
        return;
      }

      agent.value = agentResponse;
      Hay.agents.sharedChannels
        .query()
        .then((list) => (sharedChannelList.value = list))
        .catch(() => (sharedChannelList.value = []));

      // Populate form. testMode is boolean | null; null/undefined means "inherit".
      const formData = {
        name: agentResponse.name,
        description: agentResponse.description || "",
        instructions: toInstructionContent(agentResponse.instructions),
        initialGreeting: agentResponse.initialGreeting || "",
        tone: agentResponse.tone || "",
        avoid: agentResponse.avoid || "",
        trigger: agentResponse.trigger || "",
        testMode: agentResponse.testMode ?? null,
        language: agentResponse.language || "",
        channels: agentResponse.channels ?? [],
        enabled: agentResponse.enabled ?? true,
        humanHandoffAvailableInstructions: toInstructionContent(
          agentResponse.human_handoff_available_instructions,
        ),
        humanHandoffUnavailableInstructions: toInstructionContent(
          agentResponse.human_handoff_unavailable_instructions,
        ),
      };

      form.value = { ...formData };
      // Set initial form state for unsaved changes detection
      initialForm.value = JSON.parse(JSON.stringify(formData));

      // Detect which tone preset is selected
      if (agentResponse.tone) {
        for (const [key, value] of Object.entries(tonePresets)) {
          if (value === agentResponse.tone) {
            selectedTone.value = key;
            break;
          }
        }
      }

      loadingInstructions.value = false;
    }
  } catch (error) {
    console.error("Failed to load data:", error);
    if (isEditMode.value) {
      toast.error(t("agents.toast.loadFailed"));
      await router.push("/agents");
    }
  } finally {
    loading.value = false;
  }
});

// Validate form
const validateForm = () => {
  errors.value = {};

  if (!form.value.name || form.value.name.trim().length === 0) {
    errors.value.name = t("agents.form.name.required");
    return false;
  }

  if (form.value.name.length > 255) {
    errors.value.name = t("agents.form.name.tooLong");
    return false;
  }

  return true;
};

// Handle form submission
const handleSubmit = async () => {
  if (!validateForm()) {
    return;
  }

  try {
    isSubmitting.value = true;

    // Save editor data before submitting
    const savedInstructions = await instructionsEditorRef.value?.save();
    const savedHandoffAvailable = await handoffAvailableEditorRef.value?.save();
    const savedHandoffUnavailable = await handoffUnavailableEditorRef.value?.save();

    const payload = {
      name: form.value.name,
      description: form.value.description || undefined,
      instructions: toInstructionsInput(savedInstructions),
      initialGreeting: form.value.initialGreeting || undefined,
      tone: form.value.tone || undefined,
      avoid: form.value.avoid || undefined,
      trigger: form.value.trigger || undefined,
      enabled: form.value.enabled,
      testMode: form.value.testMode,
      // The language select is constrained to supported codes; empty string means inherit (null).
      language: (form.value.language || null) as AgentLanguage,
      channels: form.value.channels,
      humanHandoffAvailableInstructions: toInstructionsInput(savedHandoffAvailable),
      humanHandoffUnavailableInstructions: toInstructionsInput(savedHandoffUnavailable),
    };

    if (isEditMode.value && agentId.value) {
      // Update existing agent
      await HayApi.agents.update.mutate({
        id: agentId.value,
        data: payload,
      });
      toast.success(t("agents.toast.updatedSuccess"));
      markAsSaved(); // Mark as saved to prevent unsaved changes prompt
    } else {
      // Create new agent
      const response = await HayApi.agents.create.mutate(payload);
      toast.success(t("agents.toast.createdSuccess"));
      markAsSaved(); // Mark as saved to prevent unsaved changes prompt

      // Check if there's a redirect parameter
      const redirectPath = route.query.redirect as string;
      if (redirectPath) {
        await router.push(redirectPath);
        return;
      }

      // Navigate to the edit page after creation
      await router.push(`/agents/${response.id}`);
      return;
    }

    await router.push("/agents");
  } catch (error) {
    console.error("Failed to save agent:", error);
    // Surface the server's message as the toast detail -- a bare "please try again" gives
    // neither the customer nor support anything to act on.
    toast.error(
      isEditMode.value ? t("agents.toast.updateFailed") : t("agents.toast.createFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    isSubmitting.value = false;
  }
};

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = computed(() => t("agents.deleteDialog.title"));
const deleteDialogDescription = ref("");

// Handle delete
const handleDelete = () => {
  if (!agent.value) return;
  deleteDialogDescription.value = t("agents.deleteDialog.description", { name: agent.value.name });
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!agentId.value) return;

  try {
    isSubmitting.value = true;

    await HayApi.agents.delete.mutate({ id: agentId.value });

    toast.success(t("agents.toast.deletedSuccess"));
    markAsSaved(); // Mark as saved to prevent unsaved changes prompt

    await router.push("/agents");
  } catch (error) {
    console.error("Failed to delete agent:", error);
    toast.error(t("agents.toast.deleteFailed"));
  } finally {
    isSubmitting.value = false;
    showDeleteDialog.value = false;
  }
};

// Set this agent as the default for the organization
const setAsDefaultAgent = async () => {
  if (!agentId.value) return;

  try {
    settingAsDefault.value = true;

    await HayApi.agents.setAsDefault.mutate({ agentId: agentId.value });

    // Refresh organization data to update defaultAgentId
    const updatedOrg = await Hay.organizations.getSettings.query();
    if (updatedOrg && organizationStore.current) {
      organizationStore.setCurrent({ ...organizationStore.current, ...updatedOrg });
    }

    toast.success(t("agents.toast.setAsDefaultSuccess"));
  } catch (error) {
    console.error("Failed to set agent as default:", error);
    toast.error(t("agents.toast.setAsDefaultFailed"));
  } finally {
    settingAsDefault.value = false;
  }
};

// Handle tone selection
const setTone = (tone: string) => {
  selectedTone.value = tone;
  form.value.tone = tonePresets.value[tone as keyof typeof tonePresets.value];
};

// Handle test mode selection
const setTestMode = (value: boolean | null) => {
  form.value.testMode = value;
};

// Handle cancel
const handleCancel = async () => {
  const confirmed = await confirmNavigation();
  if (confirmed) {
    router.push("/agents");
  }
};

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: computed(() =>
    isEditMode.value ? t("agents.page.editTitle") : t("agents.page.createTitle"),
  ),
  meta: [
    {
      name: "description",
      content: computed(() =>
        isEditMode.value ? t("agents.page.editDescription") : t("agents.page.createDescription"),
      ),
    },
  ],
});
</script>
