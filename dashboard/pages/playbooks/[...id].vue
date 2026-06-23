<template>
  <div class="h-screen flex flex-col">
    <!-- Header bar — matches the conversation playground -->
    <div
      class="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex items-center justify-between gap-4 px-6 py-4">
        <!-- Left: back navigation + heading -->
        <div class="flex items-center space-x-4">
          <Button variant="ghost" size="sm" class="-ml-3" @click="handleCancel">
            <ArrowLeft class="h-4 w-4 mr-2" />
            {{ t("actions.backToList") }}
          </Button>
          <div>
            <h1 class="text-xl font-semibold">
              {{
                isEditMode ? t("edit.title", { name: playbook?.title || "" }) : t("create.title")
              }}
            </h1>
            <p class="text-sm text-neutral-muted">
              {{ isEditMode ? t("edit.description") : t("create.description") }}
            </p>
          </div>
        </div>

        <!-- Right: auto-save status + actions -->
        <div class="flex flex-wrap items-center justify-end gap-2">
          <!-- Auto-save status (edit mode) -->
          <div v-if="isEditMode && draftVersion" class="flex items-center gap-1.5 text-xs mr-1 h-5">
            <template v-if="autoSaveStatus === 'pending'">
              <Circle class="h-3 w-3 text-amber-500" />
              <span class="text-neutral-muted">{{ t("versioning.unsavedChanges") }}</span>
            </template>
            <template v-else-if="autoSaveStatus === 'saving'">
              <Loader2 class="h-3 w-3 animate-spin text-neutral-muted" />
              <span class="text-neutral-muted">{{ t("versioning.saving") }}</span>
            </template>
            <template v-else-if="autoSaveStatus === 'saved'">
              <Check class="h-3 w-3 text-green-500" />
              <span class="text-neutral-muted">
                {{ t("versioning.saved") }}
                <span v-if="lastSavedAt" class="ml-1">{{
                  formatDateTime(lastSavedAt.toISOString())
                }}</span>
              </span>
            </template>
            <template v-else-if="autoSaveStatus === 'error'">
              <AlertCircle class="h-3 w-3 text-red-500" />
              <span class="text-red-500">{{ t("versioning.saveError") }}</span>
              <button class="underline text-red-500 ml-1" @click="retryAutoSave">
                {{ t("versioning.retry") }}
              </button>
            </template>
          </div>

          <Button
            v-if="isEditMode && playbook"
            variant="outline"
            size="sm"
            @click="showVersionHistory = true"
          >
            <History class="h-4 w-4 mr-2" />
            {{ t("versioning.history.button") }}
          </Button>

          <!-- Edit mode: Save (identity) + Publish -->
          <template v-if="isEditMode">
            <Button
              variant="outline"
              size="sm"
              :loading="isSubmitting"
              :disabled="!form.title || !form.trigger"
              @click="handleSubmit"
            >
              {{ t("actions.saveChanges") }}
            </Button>
            <Button
              size="sm"
              :loading="isPublishing"
              :disabled="!draftVersion"
              @click="showPublishDialog = true"
            >
              <Upload class="h-4 w-4 mr-2" />
              {{ t("versioning.publish") }}
            </Button>
          </template>

          <!-- Create mode: single Create button -->
          <Button
            v-else
            size="sm"
            :loading="isSubmitting"
            :disabled="!form.title || !form.trigger"
            @click="handleSubmit"
          >
            {{ t("actions.createPlaybook") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-hidden">
      <div v-if="loading" class="text-center py-12">
        <Loading :label="t('loading.loadingPlaybook')" />
      </div>

      <div v-else-if="!isEditMode || playbook" data-testid="playbook-form" class="playbook-editor">
        <!-- Main document column — plain white canvas, no card chrome -->
        <section class="playbook-editor-main bg-background">
          <div class="playbook-doc">
            <input
              v-model="form.title"
              class="playbook-doc-title"
              :placeholder="t('editor.titlePlaceholder')"
              :aria-label="t('form.titleLabel')"
            />
            <p v-if="errors.title" class="text-sm text-red-500">{{ errors.title }}</p>

            <InstructionsTiptap
              ref="instructionsEditorRef"
              :initial-data="form.instructions"
              :label="t('editor.documentLabel')"
              :error="errors.instructions"
              bare
              min-height="calc(100vh - 22rem)"
              @update="handleInstructionsUpdate"
            />
          </div>
        </section>

        <!-- Right sidebar — tinted flush panel (matches conversation playground) -->
        <aside
          class="playbook-editor-sidebar border-t lg:border-t-0 lg:border-l bg-background-tertiary"
        >
          <div class="playbook-sidebar-inner space-y-6">
            <!-- Details -->
            <Card>
              <CardHeader>
                <CardTitle class="text-base">{{ t("editor.detailsSection") }}</CardTitle>
              </CardHeader>
              <CardContent class="space-y-4">
                <div class="space-y-1">
                  <Input
                    id="trigger"
                    v-model="form.trigger"
                    :label="t('form.triggerLabel')"
                    type="textarea"
                    :rows="3"
                    :placeholder="t('form.triggerPlaceholder')"
                    :class="errors.trigger ? 'border-red-500' : ''"
                    :character-limit="250"
                    :hint="t('form.triggerHint')"
                    required
                  />
                  <p v-if="errors.trigger" class="text-sm text-red-500">{{ errors.trigger }}</p>
                </div>

                <Input
                  v-model="form.description"
                  :label="t('form.descriptionLabel')"
                  type="textarea"
                  :placeholder="t('form.descriptionPlaceholder')"
                  :rows="3"
                />

                <Input
                  v-if="!isEditMode"
                  id="status"
                  v-model="form.status"
                  type="select"
                  :label="t('form.statusLabel')"
                  :options="[
                    { label: t('filters.statusDraft'), value: 'draft' },
                    { label: t('filters.statusActive'), value: 'active' },
                    { label: t('filters.statusArchived'), value: 'archived' },
                  ]"
                  class="w-full"
                />
              </CardContent>
            </Card>

            <!-- Assigned Agents -->
            <Card>
              <CardHeader>
                <CardTitle class="text-base">
                  {{ isEditMode ? t("form.assignedAgents") : t("form.assignAgents") }}
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <div v-if="loadingAgents" class="py-2 text-center text-sm text-neutral-muted">
                  {{ t("form.loadingAgents") }}
                </div>
                <div
                  v-else-if="agents.length === 0"
                  class="py-2 text-center text-sm text-neutral-muted"
                >
                  {{ t("form.noAgentsAvailable") }}
                </div>
                <div v-else class="space-y-2">
                  <div v-for="agent in agents" :key="agent.id" class="flex items-center space-x-3">
                    <input
                      :id="`agent-${agent.id}`"
                      v-model="form.agentIds"
                      type="checkbox"
                      :value="agent.id"
                      class="h-4 w-4 rounded border-gray-300"
                    />
                    <label :for="`agent-${agent.id}`" class="flex-1 cursor-pointer">
                      <div class="text-sm font-medium">{{ agent.name }}</div>
                      <div v-if="agent.description" class="text-xs text-neutral-muted">
                        {{ agent.description }}
                      </div>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>

            <!-- Available Actions -->
            <Card>
              <CardHeader>
                <CardTitle class="flex items-center justify-between text-base">
                  <span>{{ t("editor.actionsSection") }}</span>
                  <Badge v-if="actionsCount" variant="secondary">
                    {{ t("editor.actionsCount", { count: actionsCount }) }}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PlaybookActionsPanel @add="handleAddAction" @count="actionsCount = $event" />
              </CardContent>
            </Card>

            <!-- About + danger zone (edit mode only) -->
            <Card v-if="isEditMode && playbook">
              <CardHeader>
                <CardTitle class="text-base">{{ t("editor.metadataSection") }}</CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <div class="space-y-1 text-sm text-neutral-muted">
                  <div v-if="playbook.created_at">
                    {{ t("form.createdDate", { date: formatDateTime(playbook.created_at) }) }}
                  </div>
                  <div v-if="playbook.updated_at">
                    {{ t("form.lastUpdated", { date: formatDateTime(playbook.updated_at) }) }}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  class="w-full"
                  :loading="isSubmitting"
                  @click="handleDelete"
                >
                  <Trash2 class="h-4 w-4 mr-2" />
                  {{ t("actions.deletePlaybook") }}
                </Button>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      <div v-else-if="isEditMode && !loading" class="text-center py-12">
        <Error :label="t('loading.playbookNotFound')" />
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-if="isEditMode"
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :confirm-text="$t('common.delete')"
      :destructive="true"
      @confirm="confirmDelete"
    />

    <!-- Unsaved Changes Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :description="confirmDialogConfig.description"
      :confirm-text="t('actions.confirmLeave')"
      :destructive="true"
      @confirm="confirmDialogConfig.onConfirm"
      @cancel="handleDialogCancel"
    />

    <!-- Publish Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showPublishDialog"
      :title="t('versioning.publishTitle')"
      :description="t('versioning.publishDescription')"
      :confirm-text="t('versioning.publishConfirm')"
      @confirm="handlePublish"
    >
      <div class="mt-4">
        <Input
          v-model="publishNote"
          :label="t('versioning.publishNoteLabel')"
          type="textarea"
          :rows="2"
          :placeholder="t('versioning.publishNotePlaceholder')"
        />
      </div>
    </ConfirmDialog>

    <!-- Version History Sheet -->
    <VersionHistory
      v-if="isEditMode && playbookId"
      v-model:open="showVersionHistory"
      :playbook-id="playbookId"
      @rollback="handleRollback"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  ArrowLeft,
  Trash2,
  Upload,
  Loader2,
  Check,
  AlertCircle,
  Circle,
  History,
} from "lucide-vue-next";
import type { JSONContent } from "@tiptap/vue-3";
import type { MCPTool } from "@/components/tiptap/MentionExtension";
import type { PlaybookStatus, Agent, Playbook, PlaybookVersion } from "~/types/playbook";

// Instructions are authored in the Tiptap editor and stored as a Tiptap document.
const EMPTY_INSTRUCTIONS: JSONContent = { type: "doc", content: [] };

// Server-sourced instructions are opaque (jsonb); narrow to a Tiptap document for the editor.
const toInstructionContent = (value: unknown): JSONContent =>
  value && typeof value === "object" ? (value as JSONContent) : EMPTY_INSTRUCTIONS;
import { useToast } from "~/composables/useToast";
import { useUnsavedChanges } from "~/composables/useUnsavedChanges";
import { useAutoSave } from "~/composables/useAutoSave";
import { HayApi } from "@/utils/api";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

// Determine if we're in edit mode based on route
const isEditMode = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] !== "new" : id !== "new";
});

const playbookId = computed(() => {
  const id = route.params.id;
  if (Array.isArray(id)) {
    return id[0] === "new" ? null : id[0];
  }
  return id === "new" ? null : id;
});

// Form state — identity fields tracked for unsaved changes
const initialForm = ref({
  title: "",
  trigger: "",
  description: "",
  status: "draft" as PlaybookStatus,
  agentIds: [] as string[],
});

const form = ref({
  title: "",
  trigger: "",
  description: "",
  instructions: EMPTY_INSTRUCTIONS as JSONContent,
  status: "draft" as PlaybookStatus,
  agentIds: [] as string[],
});

// UI state
const loading = ref(false);
const isSubmitting = ref(false);
const isPublishing = ref(false);

// Editor refs
const instructionsEditorRef = ref<{
  save: () => JSONContent | null;
  getJSON: () => JSONContent | null;
  insertAction: (tool: MCPTool) => void;
} | null>(null);

// Insert an action chip into the instructions editor from the actions panel.
const handleAddAction = (tool: MCPTool) => {
  instructionsEditorRef.value?.insertAction(tool);
};

// Number of available actions, surfaced by the panel for the card header badge.
const actionsCount = ref(0);
const loadingAgents = ref(true);
const agents = ref<Agent[]>([]);
const playbook = ref<Playbook | null>(null);
const errors = ref<Record<string, string>>({});

// Version state
const draftVersion = ref<PlaybookVersion | null>(null);
const showPublishDialog = ref(false);
const publishNote = ref("");
const showVersionHistory = ref(false);

// Auto-save setup — only active in edit mode
const {
  status: autoSaveStatus,
  lastSavedAt,
  triggerSave: triggerAutoSave,
  flush: flushAutoSave,
  retry: retryAutoSave,
} = useAutoSave({
  saveFn: async () => {
    if (!playbookId.value || !isEditMode.value) return;
    const content = instructionsEditorRef.value?.getJSON();
    if (!content) return;

    const result = await HayApi.playbooks.versions.saveDraft.mutate({
      playbookId: playbookId.value,
      instructions: content,
    });
    draftVersion.value = result;
  },
  debounceMs: 1500,
});

// Unsaved changes — only tracks identity fields (instructions auto-save separately)
const {
  confirmNavigation,
  markAsSaved,
  showConfirmDialog,
  confirmDialogConfig,
  handleDialogCancel,
} = useUnsavedChanges(
  initialForm,
  computed(() => ({
    title: form.value.title,
    trigger: form.value.trigger,
    description: form.value.description,
    status: form.value.status,
    agentIds: form.value.agentIds,
  })),
  computed(() => !loading.value && !isSubmitting.value),
);

// Handle instructions editor update — trigger auto-save in edit mode
const handleInstructionsUpdate = () => {
  if (isEditMode.value && playbookId.value) {
    triggerAutoSave();
  }
};

// Load data on mount
onMounted(async () => {
  try {
    // Load agents
    loadingAgents.value = true;
    const agentsResponse = await HayApi.agents.list.query();
    agents.value = agentsResponse || [];

    // Load playbook if in edit mode
    if (isEditMode.value && playbookId.value) {
      loading.value = true;
      const playbookResponse = await HayApi.playbooks.get.query({
        id: playbookId.value,
      });

      if (!playbookResponse) {
        toast.error(t("toast.playbookNotFound"));
        await router.push("/playbooks");
        return;
      }

      playbook.value = playbookResponse;

      // Load or create draft version
      let draft = await HayApi.playbooks.versions.getDraft.query({
        playbookId: playbookId.value,
      });

      if (!draft) {
        draft = await HayApi.playbooks.versions.createDraft.mutate({
          playbookId: playbookId.value,
        });
      }

      draftVersion.value = draft;

      // Populate form — instructions come from draft, identity from playbook
      const identityData = {
        title: playbookResponse.title,
        trigger: playbookResponse.trigger,
        description: playbookResponse.description || "",
        status: playbookResponse.status,
        agentIds: playbookResponse.agents?.map((a: Agent) => a.id) || [],
      };

      form.value = {
        ...identityData,
        instructions: toInstructionContent(draft?.instructions || playbookResponse.instructions),
      };

      // Set initial form state for unsaved changes detection (identity fields only)
      initialForm.value = JSON.parse(JSON.stringify(identityData));
    }
  } catch (error) {
    console.error("Failed to load data:", error);
    if (isEditMode.value) {
      toast.error(t("toast.playbookNotFound"));
      await router.push("/playbooks");
    } else {
      toast.error(t("toast.loadAgentsFailed"));
    }
  } finally {
    loading.value = false;
    loadingAgents.value = false;
  }
});

// Validate form
const validateForm = () => {
  errors.value = {};

  if (!form.value.title || form.value.title.trim().length === 0) {
    errors.value.title = t("validation.titleRequired");
    return false;
  }

  if (form.value.title.length > 255) {
    errors.value.title = t("validation.titleMaxLength");
    return false;
  }

  if (!form.value.trigger || form.value.trigger.trim().length === 0) {
    errors.value.trigger = t("validation.triggerRequired");
    return false;
  }

  if (form.value.trigger.length > 255) {
    errors.value.trigger = t("validation.triggerMaxLength");
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

    if (isEditMode.value && playbookId.value) {
      // Flush any pending auto-save first
      await flushAutoSave();

      // Update identity fields only
      await HayApi.playbooks.update.mutate({
        id: playbookId.value,
        data: {
          title: form.value.title,
          trigger: form.value.trigger,
          description: form.value.description || undefined,
          agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined,
        },
      });
      toast.success(t("toast.updateSuccess"));
      markAsSaved();
    } else {
      // Create new playbook (includes instructions — backend creates initial version)
      const savedInstructions = await instructionsEditorRef.value?.save();

      const payload = {
        title: form.value.title,
        trigger: form.value.trigger,
        description: form.value.description || undefined,
        instructions: savedInstructions ?? EMPTY_INSTRUCTIONS,
        status: form.value.status,
        agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined,
      };

      const response = await HayApi.playbooks.create.mutate(payload);
      toast.success(t("toast.createSuccess"));
      markAsSaved();

      // Check if there's a redirect parameter
      const redirectPath = route.query.redirect as string;
      if (redirectPath) {
        await router.push(redirectPath);
        return;
      }

      // Navigate to the edit page after creation
      await router.push(`/playbooks/${response.id}`);
      return;
    }
  } catch (error) {
    console.error("Failed to save playbook:", error);
    toast.error(t("toast.saveFailed", { action: isEditMode.value ? "update" : "create" }));
  } finally {
    isSubmitting.value = false;
  }
};

// Handle publish
const handlePublish = async () => {
  if (!playbookId.value) return;

  try {
    isPublishing.value = true;

    // Flush any pending auto-save first
    await flushAutoSave();

    await HayApi.playbooks.versions.publish.mutate({
      playbookId: playbookId.value,
      note: publishNote.value || undefined,
    });

    toast.success(t("versioning.publishSuccess"));
    publishNote.value = "";
    showPublishDialog.value = false;

    // Draft is cleared after publish — reset state
    draftVersion.value = null;

    // Reload the playbook to get updated state
    const updated = await HayApi.playbooks.get.query({ id: playbookId.value });
    if (updated) {
      playbook.value = updated;
    }
  } catch (error) {
    console.error("Failed to publish:", error);
    toast.error(t("versioning.publishFailed"));
  } finally {
    isPublishing.value = false;
  }
};

// Handle rollback (triggered from VersionHistory component)
const handleRollback = async () => {
  if (!playbookId.value) return;

  // Reload playbook and reset draft state
  const updated = await HayApi.playbooks.get.query({ id: playbookId.value });
  if (updated) {
    playbook.value = updated;
    form.value.instructions = toInstructionContent(updated.instructions);
    // Draft was deleted by rollback — reset
    draftVersion.value = null;
    initialForm.value = JSON.parse(
      JSON.stringify({
        title: updated.title,
        trigger: updated.trigger,
        description: updated.description || "",
        status: updated.status,
        agentIds: updated.agents?.map((a: Agent) => a.id) || [],
      }),
    );
  }
};

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref(t("delete.title"));
const deleteDialogDescription = ref("");

// Handle delete
const handleDelete = () => {
  if (!playbook.value) return;
  deleteDialogDescription.value = t("delete.confirmMessage", { name: playbook.value.title });
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!playbookId.value) return;

  try {
    isSubmitting.value = true;

    await HayApi.playbooks.delete.mutate({ id: playbookId.value });

    toast.success(t("toast.deleteSuccess"));
    markAsSaved();

    await router.push("/playbooks");
  } catch (error) {
    console.error("Failed to delete playbook:", error);
    toast.error(t("toast.deleteFailed"));
  } finally {
    isSubmitting.value = false;
    showDeleteDialog.value = false;
  }
};

// Handle cancel
const handleCancel = async () => {
  // Flush auto-save before checking unsaved changes
  if (isEditMode.value) {
    await flushAutoSave();
  }
  const confirmed = await confirmNavigation();
  if (confirmed) {
    router.push("/playbooks");
  }
};

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: computed(() => (isEditMode.value ? t("edit.headTitle") : t("create.headTitle"))),
  meta: [
    {
      name: "description",
      content: computed(() =>
        isEditMode.value ? t("create.editHeadDescription") : t("create.headDescription"),
      ),
    },
  ],
});
</script>

<style scoped>
/*
 * Two-pane document-editor layout, modelled on the conversation playground:
 * a plain white body canvas on the left and a flush, tinted context panel on
 * the right. The container fills the body region (flex-1) so both columns
 * scroll independently with no trailing empty space.
 */
.playbook-editor {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.playbook-editor-main {
  flex: 1 1 0%;
  min-width: 0;
  overflow-y: auto;
  padding: 2rem 2.5rem;
}

/* Centered document column within the white canvas. */
.playbook-doc {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 80ch;
  margin: 0 auto;
}

.playbook-editor-sidebar {
  width: 24rem;
  flex-shrink: 0;
  overflow-y: auto;
}

.playbook-sidebar-inner {
  padding: 1.5rem;
}

.playbook-doc-title {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1.875rem;
  line-height: 2.25rem;
  font-weight: 700;
  color: var(--color-foreground);
}

.playbook-doc-title::placeholder {
  color: var(--color-neutral-muted);
}

/* Stack the panes on narrow viewports. */
@media (max-width: 1024px) {
  .playbook-editor {
    flex-direction: column;
    height: auto;
    overflow-y: auto;
  }

  .playbook-editor-main,
  .playbook-editor-sidebar {
    overflow-y: visible;
  }

  .playbook-editor-main {
    padding: 1.5rem;
  }

  .playbook-editor-sidebar {
    width: 100%;
  }
}
</style>
