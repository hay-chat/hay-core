<template>
  <Page
    :title="isEditMode ? t('edit.title', { name: playbook?.title }) : t('create.title')"
    :description="isEditMode ? t('edit.description') : t('create.description')"
    width="max"
  >
    <template #header>
      <Button v-if="isEditMode" variant="ghost" @click="() => router.push('/playbooks')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ t("actions.backToList") }}
      </Button>
    </template>

    <div v-if="loading" class="text-center py-12">
      <Loading :label="t('loading.loadingPlaybook')" />
    </div>

    <Card v-else-if="!isEditMode || playbook">
      <CardContent class="p-6">
        <form data-testid="playbook-form" class="space-y-6" @submit.prevent="handleSubmit">
          <!-- Title Field -->
          <div class="space-y-2">
            <Input
              id="title"
              v-model="form.title"
              :label="t('form.titleLabel')"
              :placeholder="t('form.titlePlaceholder')"
              :class="errors.title ? 'border-red-500' : ''"
              required
            />
            <p v-if="errors.title" class="text-sm text-red-500">
              {{ errors.title }}
            </p>
          </div>

          <!-- Trigger Field -->
          <div class="space-y-2">
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
            <p v-if="errors.trigger" class="text-sm text-red-500">
              {{ errors.trigger }}
            </p>
          </div>

          <!-- Description Field -->
          <div class="space-y-2">
            <Input
              v-model="form.description"
              :label="t('form.descriptionLabel')"
              type="textarea"
              :placeholder="t('form.descriptionPlaceholder')"
              :rows="3"
            />
          </div>

          <!-- Instructions Field -->
          <InstructionsTiptap
            ref="instructionsEditorRef"
            :initial-data="form.instructions"
            :label="t('form.instructionsLabel')"
            :hint="t('form.instructionsHint')"
            :error="errors.instructions"
          />

          <!-- Status Field -->
          <div class="space-y-2">
            <Input
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
          </div>

          <!-- Agent Selection -->
          <div class="space-y-2">
            <label class="text-sm font-medium">{{
              isEditMode ? t("form.assignedAgents") : t("form.assignAgents")
            }}</label>
            <div v-if="loadingAgents" class="p-4 text-center text-neutral-muted">
              {{ t("form.loadingAgents") }}
            </div>
            <div v-else-if="agents.length === 0" class="p-4 text-center text-neutral-muted">
              {{ t("form.noAgentsAvailable") }}
            </div>
            <div v-else class="space-y-2 border rounded-md p-4">
              <div v-for="agent in agents" :key="agent.id" class="flex items-center space-x-3">
                <input
                  :id="`agent-${agent.id}`"
                  v-model="form.agentIds"
                  type="checkbox"
                  :value="agent.id"
                  class="h-4 w-4 rounded border-gray-300"
                />
                <label :for="`agent-${agent.id}`" class="flex-1 cursor-pointer">
                  <div class="font-medium">{{ agent.name }}</div>
                  <div v-if="agent.description" class="text-sm text-neutral-muted">
                    {{ agent.description }}
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Metadata (only in edit mode) -->
          <div v-if="isEditMode && playbook" class="space-y-2 text-sm text-neutral-muted">
            <div v-if="playbook.created_at">
              {{ t("form.createdDate", { date: formatDateTime(playbook.created_at) }) }}
            </div>
            <div v-if="playbook.updated_at">
              {{ t("form.lastUpdated", { date: formatDateTime(playbook.updated_at) }) }}
            </div>
          </div>

          <!-- Form Actions -->
          <div class="flex justify-between pt-4">
            <Button
              v-if="isEditMode"
              type="button"
              variant="destructive"
              :loading="isSubmitting"
              @click="handleDelete"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              {{ t("actions.deletePlaybook") }}
            </Button>

            <div :class="isEditMode ? '' : 'w-full'" class="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                :disabled="isSubmitting"
                @click="handleCancel"
              >
                {{ $t("common.cancel") }}
              </Button>
              <Button
                type="submit"
                :loading="isSubmitting"
                :disabled="!form.title || !form.trigger"
              >
                {{ isEditMode ? t("actions.saveChanges") : t("actions.createPlaybook") }}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>

    <div v-else-if="isEditMode && !loading" class="text-center py-12">
      <Error :label="t('loading.playbookNotFound')" />
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
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ArrowLeft, Trash2 } from "lucide-vue-next";
import type { PlaybookStatus, Agent, Playbook } from "~/types/playbook";

type InstructionData = {
  id: string;
  level: number;
  instructions: string;
};
import { useToast } from "~/composables/useToast";
import { useUnsavedChanges } from "~/composables/useUnsavedChanges";
import { HayApi } from "@/utils/api";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();
const loadingInstructions = ref(false);

// Track initial form state for unsaved changes detection
const initialForm = ref({
  title: "",
  trigger: "",
  description: "",
  instructions: [] as InstructionData[],
  status: "draft" as PlaybookStatus,
  agentIds: [] as string[],
});

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

// Form state
const form = ref({
  title: "",
  trigger: "",
  description: "",
  instructions: { blocks: [] } as any,
  status: "draft" as PlaybookStatus,
  agentIds: [] as string[],
});

// UI state
const loading = ref(false);
const isSubmitting = ref(false);

// Editor refs
const instructionsEditorRef = ref<{ save: () => Promise<unknown> } | null>(null);
const loadingAgents = ref(true);
const agents = ref<Agent[]>([]);
const playbook = ref<
  | Playbook
  | {
      id: string;
      title: string;
      trigger: string;
      description?: string | null;
      instructions?: string | { id: string; level: number; instructions: string }[] | null;
      status: PlaybookStatus;
      organization_id: string | null;
      agents?: Agent[];
      created_at: string;
      updated_at: string;
    }
  | null
>(null);
const errors = ref<Record<string, string>>({});

// Unsaved changes detection
const {
  hasUnsavedChanges,
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
    // Load agents
    loadingAgents.value = true;
    const agentsResponse = await HayApi.agents.list.query();
    agents.value = agentsResponse || [];

    // Load playbook if in edit mode
    if (isEditMode.value && playbookId.value) {
      loading.value = true;
      loadingInstructions.value = true;
      const playbookResponse = await HayApi.playbooks.get.query({
        id: playbookId.value,
      });

      if (!playbookResponse) {
        toast.error(t("toast.playbookNotFound"));
        await router.push("/playbooks");
        return;
      }

      playbook.value = playbookResponse;

      // Populate form
      const formData = {
        title: playbookResponse.title,
        trigger: playbookResponse.trigger,
        description: playbookResponse.description || "",
        instructions: playbookResponse.instructions || { blocks: [] },
        status: playbookResponse.status,
        agentIds: playbookResponse.agents?.map((a) => a.id) || [],
      };

      form.value = { ...formData };
      // Set initial form state for unsaved changes detection
      initialForm.value = JSON.parse(JSON.stringify(formData));

      loadingInstructions.value = false;
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

    // Save editor data before submitting
    const savedInstructions = await instructionsEditorRef.value?.save();

    const payload = {
      title: form.value.title,
      trigger: form.value.trigger,
      description: form.value.description || undefined,
      instructions: savedInstructions || { blocks: [] },
      status: form.value.status,
      agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined,
    };

    if (isEditMode.value && playbookId.value) {
      // Update existing playbook
      await HayApi.playbooks.update.mutate({
        id: playbookId.value,
        data: payload,
      });
      toast.success(t("toast.updateSuccess"));
      markAsSaved(); // Mark as saved to prevent unsaved changes prompt
    } else {
      // Create new playbook
      const response = await HayApi.playbooks.create.mutate(payload);
      toast.success(t("toast.createSuccess"));
      markAsSaved(); // Mark as saved to prevent unsaved changes prompt

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

    await router.push("/playbooks");
  } catch (error) {
    console.error("Failed to save playbook:", error);
    const action = isEditMode.value
      ? t("toast.updateSuccess").split(" ")[0].toLowerCase()
      : t("toast.createSuccess").split(" ")[0].toLowerCase();
    toast.error(t("toast.saveFailed", { action: isEditMode.value ? "update" : "create" }));
  } finally {
    isSubmitting.value = false;
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
    markAsSaved(); // Mark as saved to prevent unsaved changes prompt

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
