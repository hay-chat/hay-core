<template>
  <Page title="Agent" description="Configure a new AI agent for your organization" width="max">
    <template #header>
      <Button v-if="isEditMode" variant="ghost" @click="() => router.push('/agents')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back to list
      </Button>
    </template>

    <div v-if="loading" class="text-center py-12">
      <Loading label="Loading agent..." />
    </div>

    <template v-else-if="!isEditMode || agent">
      <form data-testid="agent-form" class="space-y-6" @submit.prevent="handleSubmit">
        <Card>
          <CardHeader>
            <CardTitle>Agent</CardTitle>
            <CardDescription
              >Define the agent's behavior and how it should respond to users.</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Name Field -->
            <Input
              id="name"
              v-model="form.name"
              label="Name"
              placeholder="e.g., Customer Support Agent"
              :class="errors.name ? 'border-red-500' : ''"
              :helper-text="errors.name"
              required
            />
            <!-- Description Field -->
            <Input
              id="description"
              v-model="form.description"
              type="textarea"
              label="Description"
              helper-text="This is an internal description and it won't be visible to the user nor the agent."
              placeholder="Describe what this agent does..."
            />
            <!-- Instructions Field -->
            <InstructionsEditor
              v-model="form.instructions"
              label="Instructions"
              :loading="loadingInstructions"
              hint="Define the general agent's behavior and how it should respond to users. DO NOT include any specific instructions for the agent to follow - use the Playbooks to define that."
              :error="errors.instructions"
            />
            <!-- Tone Field -->
            <div>
              <Label cla>Tone</Label>
              <div class="gap-4 mb-4 mt-2 grid grid-cols-3">
                <OptionCard
                  :image="'/bale/professional.svg'"
                  label="Professional"
                  :checked="selectedTone === 'professional'"
                  @click="setTone('professional')"
                />
                <OptionCard
                  :image="'/bale/casual.svg'"
                  label="Casual"
                  :checked="selectedTone === 'casual'"
                  @click="setTone('casual')"
                />
                <OptionCard
                  :image="'/bale/enthusiastic.svg'"
                  label="Enthusiastic"
                  :checked="selectedTone === 'enthusiastic'"
                  @click="setTone('enthusiastic')"
                />
              </div>
              <Input
                id="tone"
                v-model="form.tone"
                type="textarea"
                placeholder="Describe the communication tone (e.g., professional, friendly, casual)..."
              />
            </div>
            <!-- Things to Avoid Field -->
            <Input
              id="avoid"
              v-model="form.avoid"
              type="textarea"
              label="Things to Avoid"
              placeholder="List things the agent should avoid (e.g., technical jargon, certain topics)..."
            />
            <!-- Trigger Field -->
            <Input
              id="trigger"
              v-model="form.trigger"
              type="textarea"
              label="Trigger Conditions"
              placeholder="Define when this agent should be triggered (e.g., specific keywords, conditions)..."
            />
            <!-- Enabled Field -->
            <div class="space-y-2">
              <div class="flex items-center space-x-2">
                <Input
                  id="enabled"
                  v-model="form.enabled"
                  type="switch"
                  label="Enable agent"
                  helper-text="Enable the agent to start receiving messages from customers."
                />
              </div>
            </div>

            <!-- Metadata (only in edit mode) -->
            <div v-if="isEditMode && agent" class="space-y-2 text-sm text-neutral-muted">
              <div>Created: {{ formatDate(agent.created_at) }}</div>
              <div>Last updated: {{ formatDate(agent.updated_at) }}</div>
            </div>
          </CardContent>
        </Card>

        <!-- Test Mode Field -->
        <Card>
          <CardHeader>
            <CardTitle>Test Mode</CardTitle>
            <CardDescription>Define the test mode for the agent.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-6">
            <!-- Test Mode Field -->
            <div class="space-y-2">
              <Label>Test Mode</Label>
              <p class="text-sm text-neutral-muted mb-3">
                When enabled, AI messages require approval before sending to customers. Playground
                always bypasses this.
              </p>
              <Input
                id="testMode"
                v-model="form.testMode"
                type="select"
                :options="[
                  { label: 'Inherit from Organization', value: null },
                  { label: 'On (Require Approval)', value: true },
                  { label: 'Off (Auto-Send)', value: false },
                ]"
                helper-text="Set to 'Inherit' to use organization default, or override per agent"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Human escalation</CardTitle>
            <CardDescription
              >Define the instructions for the agent to follow when a human agent is available or
              unavailable.</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-6">
            <InstructionsEditor
              v-model="form.humanHandoffAvailableInstructions"
              label="If any human agent is available"
              hint="Define the instructions for the agent to follow when a human agent is available. Leave empty to simply change status to 'pending-human'."
            />

            <InstructionsEditor
              v-model="form.humanHandoffUnavailableInstructions"
              label="If all human agents are unavailable"
              hint="Define the instructions for the agent to follow when no human agents are available (e.g., create a ticket, ask for email)."
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
                Delete Agent
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
                <Button type="submit" :loading="isSubmitting" :disabled="!form.name">
                  {{ isEditMode ? "Save Changes" : "Create Agent" }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </template>

    <div v-else-if="isEditMode && !loading" class="text-center py-12">
      <Error label="Agent not found" />
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
import type { Agent } from "~/types/playbook";
import { useToast } from "~/composables/useToast";
import { HayApi } from "@/utils/api";

const router = useRouter();
const route = useRoute();
const toast = useToast();
const loadingInstructions = ref(false);

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

// Tone presets
const tonePresets = {
  professional: `Your tone is professional, calm, and concise. You communicate clearly, use complete sentences, and avoid slang or emojis. You sound confident but approachable — like a well-trained support specialist who respects the customer's time. You empathize when appropriate, but always keep focus on solving the issue efficiently.

Example: "I understand how that could be frustrating. Let's take a look at your order status together. Could you please confirm your order number?"`,
  casual: `You sound like a real person chatting over text — relaxed, warm, and approachable. Use contractions, simple phrasing, and occasional emojis when it fits the vibe. Keep answers helpful but conversational, like a teammate helping out a friend.

Example: "Hey there! Totally get it — that happens sometimes 😅 Let me check your order real quick so we can sort this out."`,
  enthusiastic: `You make every customer interaction feel exciting and positive. You use exclamation marks moderately, express enthusiasm for helping, and celebrate small wins. You make the customer feel heard and valued while keeping replies short and impactful.

Example: "Great question! Let's get this sorted out right away 🎉 I just need your email to find your order!"`,
};

// Form state
const form = ref({
  name: "",
  description: "",
  instructions: [] as any,
  tone: "",
  avoid: "",
  trigger: "",
  enabled: true,
  testMode: null as boolean | null,
  humanHandoffAvailableInstructions: [] as any,
  humanHandoffUnavailableInstructions: [] as any,
});

// UI state
const loading = ref(false);
const isSubmitting = ref(false);
const agent = ref<Agent | null>(null);
const errors = ref<Record<string, string>>({});
const selectedTone = ref<string | null>(null);

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
    // Load agent if in edit mode
    if (isEditMode.value && agentId.value) {
      loading.value = true;
      loadingInstructions.value = true;
      const agentResponse = await HayApi.agents.get.query({
        id: agentId.value,
      });

      if (!agentResponse) {
        toast.error("Agent not found");
        await router.push("/agents");
        return;
      }

      agent.value = agentResponse;

      // Populate form
      form.value = {
        name: agentResponse.name,
        description: agentResponse.description || "",
        instructions: agentResponse.instructions || [],
        tone: agentResponse.tone || "",
        avoid: agentResponse.avoid || "",
        trigger: agentResponse.trigger || "",
        testMode: (agentResponse as any).testMode ?? null,
        enabled: agentResponse.enabled ?? true,
        humanHandoffAvailableInstructions:
          (agentResponse as any).human_handoff_available_instructions || [],
        humanHandoffUnavailableInstructions:
          (agentResponse as any).human_handoff_unavailable_instructions || [],
      };

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
      toast.error("Failed to load agent");
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
    errors.value.name = "Agent name is required";
    return false;
  }

  if (form.value.name.length > 255) {
    errors.value.name = "Agent name must be less than 255 characters";
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
      name: form.value.name,
      description: form.value.description || undefined,
      instructions: form.value.instructions,
      tone: form.value.tone || undefined,
      avoid: form.value.avoid || undefined,
      trigger: form.value.trigger || undefined,
      enabled: form.value.enabled,
      humanHandoffAvailableInstructions: form.value.humanHandoffAvailableInstructions,
      humanHandoffUnavailableInstructions: form.value.humanHandoffUnavailableInstructions,
    };

    if (isEditMode.value && agentId.value) {
      // Update existing agent
      await HayApi.agents.update.mutate({
        id: agentId.value,
        data: payload,
      });
      toast.success("Agent updated successfully");
    } else {
      // Create new agent
      const response = await HayApi.agents.create.mutate(payload);
      toast.success("Agent created successfully");

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
    toast.error(`Failed to ${isEditMode.value ? "update" : "create"} agent. Please try again.`);
  } finally {
    isSubmitting.value = false;
  }
};

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref("Delete Agent");
const deleteDialogDescription = ref("");

// Handle delete
const handleDelete = () => {
  if (!agent.value) return;
  deleteDialogDescription.value = `Are you sure you want to delete "${agent.value.name}"? This action cannot be undone.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  if (!agentId.value) return;

  try {
    isSubmitting.value = true;

    await HayApi.agents.delete.mutate({ id: agentId.value });

    toast.success("Agent deleted successfully");

    await router.push("/agents");
  } catch (error) {
    console.error("Failed to delete agent:", error);
    toast.error("Failed to delete agent. Please try again.");
  } finally {
    isSubmitting.value = false;
    showDeleteDialog.value = false;
  }
};

// Handle tone selection
const setTone = (tone: string) => {
  selectedTone.value = tone;
  form.value.tone = tonePresets[tone as keyof typeof tonePresets];
};

// Handle cancel
const handleCancel = () => {
  router.push("/agents");
};

// Set page meta
definePageMeta({
  layout: "default",
});

// Head management
useHead({
  title: computed(() => `${isEditMode.value ? "Edit" : "Create"} Agent - Hay Dashboard`),
  meta: [
    {
      name: "description",
      content: computed(() =>
        isEditMode.value ? "Edit your AI agent configuration" : "Create a new AI agent",
      ),
    },
  ],
});
</script>
