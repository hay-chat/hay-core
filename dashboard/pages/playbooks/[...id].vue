<template>
  <Page
    :title="isEditMode ? 'Edit' : 'Create New'"
    :description="
      isEditMode
        ? ' Update your playbook configuration'
        : 'Define automated conversation flows for your agents'
    "
    width="max"
  >
    <template #header>
      <Button v-if="isEditMode" variant="ghost" @click="() => router.push('/playbooks')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back to list
      </Button>
    </template>

    <div v-if="loading" class="text-center py-12">
      <Loading label="Loading playbook..." />
    </div>

    <Card v-else-if="!isEditMode || playbook">
      <CardContent class="p-6">
        <form data-testid="playbook-form" class="space-y-6" @submit.prevent="handleSubmit">
          <!-- Title Field -->
          <div class="space-y-2">
            <label for="title" class="text-sm font-medium">
              Playbook Title <span class="text-red-500">*</span>
            </label>
            <Input
              id="title"
              v-model="form.title"
              placeholder="e.g., Customer Support Automation"
              :class="errors.title ? 'border-red-500' : ''"
              required
            />
            <p v-if="errors.title" class="text-sm text-red-500">
              {{ errors.title }}
            </p>
          </div>

          <!-- Trigger Field -->
          <div class="space-y-2">
            <label for="trigger" class="text-sm font-medium">
              Trigger <span class="text-red-500">*</span>
            </label>
            <Input
              id="trigger"
              v-model="form.trigger"
              placeholder="e.g., customer_inquiry, ticket_created"
              :class="errors.trigger ? 'border-red-500' : ''"
              required
            />
            <p v-if="errors.trigger" class="text-sm text-red-500">
              {{ errors.trigger }}
            </p>
            <p class="text-sm text-neutral-muted">Define when this playbook should be activated</p>
          </div>

          <!-- Description Field -->
          <div class="space-y-2">
            <label for="description" class="text-sm font-medium"> Description </label>
            <Textarea
              id="description"
              v-model="form.description"
              placeholder="Describe what this playbook does..."
              :rows="3"
            />
          </div>

          <!-- Instructions Field -->
          <InstructionsEditor
            v-model="form.instructions"
            label="Instructions"
            :loading="loadingInstructions"
            hint="Create numbered step-by-step instructions that agents will follow when executing this playbook"
            :error="errors.instructions"
          />

          <!-- Status Field -->
          <div class="space-y-2">
            <label for="status" class="text-sm font-medium">Status</label>
            <select
              id="status"
              v-model="form.status"
              class="w-full px-3 py-2 text-sm border border-input rounded-md"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <!-- Agent Selection -->
          <div class="space-y-2">
            <label class="text-sm font-medium"
              >{{ isEditMode ? "Assigned" : "Assign" }} Agents</label
            >
            <div v-if="loadingAgents" class="p-4 text-center text-neutral-muted">
              Loading agents...
            </div>
            <div v-else-if="agents.length === 0" class="p-4 text-center text-neutral-muted">
              No agents available. Create agents first.
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
            <div>Created: {{ formatDate(playbook.created_at) }}</div>
            <div>Last updated: {{ formatDate(playbook.updated_at) }}</div>
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
              Delete Playbook
            </Button>

            <div :class="isEditMode ? '' : 'w-full'" class="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                :disabled="isSubmitting"
                @click="handleCancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                :loading="isSubmitting"
                :disabled="!form.title || !form.trigger"
              >
                {{ isEditMode ? "Save Changes" : "Create Playbook" }}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>

    <div v-else-if="isEditMode && !loading" class="text-center py-12">
      <Error label="Playbook not found" />
    </div>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-if="isEditMode"
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      confirm-text="Delete"
      :destructive="true"
      @confirm="confirmDelete"
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
import { HayApi } from "@/utils/api";

const router = useRouter();
const route = useRoute();
const toast = useToast();
const loadingInstructions = ref(false);

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
  instructions: [] as InstructionData[],
  status: "draft" as PlaybookStatus,
  agentIds: [] as string[],
});

// UI state
const loading = ref(false);
const isSubmitting = ref(false);
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

// Format date
const formatDate = (date: string | Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
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
      loadingInstructions.value = true;
      const playbookResponse = await HayApi.playbooks.get.query({
        id: playbookId.value,
      });

      if (!playbookResponse) {
        toast.error("Playbook not found");
        await router.push("/playbooks");
        return;
      }

      playbook.value = playbookResponse;

      // Populate form
      form.value = {
        title: playbookResponse.title,
        trigger: playbookResponse.trigger,
        description: playbookResponse.description || "",
        instructions: Array.isArray(playbookResponse.instructions)
          ? (playbookResponse.instructions as InstructionData[])
          : [],
        status: playbookResponse.status,
        agentIds: playbookResponse.agents?.map((a) => a.id) || [],
      };

      loadingInstructions.value = false;
    }
  } catch (error) {
    console.error("Failed to load data:", error);
    if (isEditMode.value) {
      toast.error("Failed to load playbook");
      await router.push("/playbooks");
    } else {
      toast.error("Failed to load agents");
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
    errors.value.title = "Playbook title is required";
    return false;
  }

  if (form.value.title.length > 255) {
    errors.value.title = "Playbook title must be less than 255 characters";
    return false;
  }

  if (!form.value.trigger || form.value.trigger.trim().length === 0) {
    errors.value.trigger = "Trigger is required";
    return false;
  }

  if (form.value.trigger.length > 255) {
    errors.value.trigger = "Trigger must be less than 255 characters";
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

    const payload = {
      title: form.value.title,
      trigger: form.value.trigger,
      description: form.value.description || undefined,
      instructions: form.value.instructions.length > 0 ? form.value.instructions : null,
      status: form.value.status,
      agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined,
    };

    if (isEditMode.value && playbookId.value) {
      // Update existing playbook
      await HayApi.playbooks.update.mutate({
        id: playbookId.value,
        data: payload,
      });
      toast.success("Playbook updated successfully");
    } else {
      // Create new playbook
      const response = await HayApi.playbooks.create.mutate(payload);
      toast.success("Playbook created successfully");

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
    toast.error(`Failed to ${isEditMode.value ? "update" : "create"} playbook. Please try again.`);
  } finally {
    isSubmitting.value = false;
  }
};

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref("Delete Playbook");
const deleteDialogDescription = ref("");

// Handle delete
const handleDelete = () => {
  if (!playbook.value) return;
  deleteDialogDescription.value = `Are you sure you want to delete "${playbook.value.title}"? This action cannot be undone.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!playbookId.value) return;

  try {
    isSubmitting.value = true;

    await HayApi.playbooks.delete.mutate({ id: playbookId.value });

    toast.success("Playbook deleted successfully");

    await router.push("/playbooks");
  } catch (error) {
    console.error("Failed to delete playbook:", error);
    toast.error("Failed to delete playbook. Please try again.");
  } finally {
    isSubmitting.value = false;
    showDeleteDialog.value = false;
  }
};

// Handle cancel
const handleCancel = () => {
  router.push("/playbooks");
};

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: computed(() => `${isEditMode.value ? "Edit" : "Create"} Playbook - Hay Dashboard`),
  meta: [
    {
      name: "description",
      content: computed(() =>
        isEditMode.value
          ? "Edit your automated conversation playbook"
          : "Create a new automated conversation playbook",
      ),
    },
  ],
});
</script>
