<template>
  <div class="container mx-auto max-w-4xl py-8">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold mb-2">Edit Playbook</h1>
        <p class="text-muted-foreground">
          Update your playbook configuration
        </p>
      </div>
      <Button variant="ghost" @click="() => router.push('/playbooks')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back to list
      </Button>
    </div>

    <div v-if="loading" class="text-center py-12">
      <Loader2 class="h-8 w-8 animate-spin mx-auto mb-4" />
      <p class="text-muted-foreground">Loading playbook...</p>
    </div>

    <Card v-else-if="playbook">
      <CardContent class="p-6">
        <form @submit.prevent="handleSubmit" class="space-y-6">
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
            <p class="text-sm text-muted-foreground">
              Define when this playbook should be activated
            </p>
          </div>

          <!-- Description Field -->
          <div class="space-y-2">
            <label for="description" class="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="description"
              v-model="form.description"
              placeholder="Describe what this playbook does..."
              :rows="3"
            />
          </div>

          <!-- Instructions Field -->
          <div class="space-y-2">
            <label for="instructions" class="text-sm font-medium">
              Instructions
            </label>
            <Textarea
              id="instructions"
              v-model="form.instructions"
              placeholder="Enter detailed instructions for agents..."
              :rows="8"
            />
            <p class="text-sm text-muted-foreground">
              Provide clear instructions that agents will follow when executing this playbook
            </p>
          </div>

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
            <label class="text-sm font-medium">Assigned Agents</label>
            <div v-if="loadingAgents" class="p-4 text-center text-muted-foreground">
              Loading agents...
            </div>
            <div v-else-if="agents.length === 0" class="p-4 text-center text-muted-foreground">
              No agents available. Create agents first.
            </div>
            <div v-else class="space-y-2 border rounded-md p-4">
              <div 
                v-for="agent in agents" 
                :key="agent.id"
                class="flex items-center space-x-3"
              >
                <input
                  :id="`agent-${agent.id}`"
                  type="checkbox"
                  :value="agent.id"
                  v-model="form.agentIds"
                  class="h-4 w-4 rounded border-gray-300"
                />
                <label 
                  :for="`agent-${agent.id}`"
                  class="flex-1 cursor-pointer"
                >
                  <div class="font-medium">{{ agent.name }}</div>
                  <div v-if="agent.description" class="text-sm text-muted-foreground">
                    {{ agent.description }}
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div class="space-y-2 text-sm text-muted-foreground">
            <div>Created: {{ formatDate(playbook.created_at) }}</div>
            <div>Last updated: {{ formatDate(playbook.updated_at) }}</div>
          </div>

          <!-- Form Actions -->
          <div class="flex justify-between pt-4">
            <Button
              type="button"
              variant="destructive"
              @click="handleDelete"
              :disabled="isSubmitting"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              Delete Playbook
            </Button>
            
            <div class="flex space-x-4">
              <Button
                type="button"
                variant="outline"
                @click="handleCancel"
                :disabled="isSubmitting"
              >
                Cancel
              </Button>
              <Button type="submit" :disabled="isSubmitting || !form.title || !form.trigger">
                <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
                {{ isSubmitting ? 'Saving...' : 'Save Changes' }}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>

    <div v-else class="text-center py-12">
      <p class="text-red-500">Playbook not found</p>
    </div>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showDeleteDialog"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      confirm-text="Delete"
      :destructive="true"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Loader2, ArrowLeft, Trash2 } from 'lucide-vue-next';
import type { Playbook, Agent, PlaybookStatus } from '~/types/playbook';
import { useToast } from '~/composables/useToast';
import { HayApi } from '@/utils/api';

const router = useRouter();
const route = useRoute();
const { toast } = useToast();

const playbookId = route.params.id as string;

// Form state
const form = ref({
  title: '',
  trigger: '',
  description: '',
  instructions: {} as any,
  status: 'draft' as PlaybookStatus,
  agentIds: [] as string[]
});

// UI state
const loading = ref(true);
const isSubmitting = ref(false);
const loadingAgents = ref(true);
const agents = ref<any[]>([]);
const playbook = ref<any>(null);
const errors = ref<Record<string, string>>({});

// Format date
const formatDate = (date: string | Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
};

// Load playbook and agents on mount
onMounted(async () => {
  try {
    // Load playbook
    loading.value = true;
    const playbookResponse = await HayApi.playbooks.get.query({ id: playbookId });
    
    if (!playbookResponse) {
      toast('error', 'Playbook not found');
      await router.push('/playbooks');
      return;
    }
    
    playbook.value = playbookResponse;
    
    // Populate form
    form.value = {
      title: playbookResponse.title,
      trigger: playbookResponse.trigger,
      description: playbookResponse.description || '',
      instructions: playbookResponse.instructions || {},
      status: playbookResponse.status,
      agentIds: playbookResponse.agents?.map((a: any) => a.id) || []
    };
    
    // Load agents
    loadingAgents.value = true;
    const agentsResponse = await HayApi.agents.list.query();
    agents.value = agentsResponse || [];
    
  } catch (error) {
    console.error('Failed to load data:', error);
    toast('error', 'Failed to load playbook');
    await router.push('/playbooks');
  } finally {
    loading.value = false;
    loadingAgents.value = false;
  }
});

// Validate form
const validateForm = () => {
  errors.value = {};
  
  if (!form.value.title || form.value.title.trim().length === 0) {
    errors.value.title = 'Playbook title is required';
    return false;
  }
  
  if (form.value.title.length > 255) {
    errors.value.title = 'Playbook title must be less than 255 characters';
    return false;
  }
  
  if (!form.value.trigger || form.value.trigger.trim().length === 0) {
    errors.value.trigger = 'Trigger is required';
    return false;
  }
  
  if (form.value.trigger.length > 255) {
    errors.value.trigger = 'Trigger must be less than 255 characters';
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
    
    await HayApi.playbooks.update.mutate({
      id: playbookId,
      data: {
        title: form.value.title,
        trigger: form.value.trigger,
        description: form.value.description || undefined,
        instructions: form.value.instructions || undefined,
        status: form.value.status,
        agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined
      }
    });

    toast('success', 'Playbook updated successfully');

    await router.push('/playbooks');
  } catch (error) {
    console.error('Failed to update playbook:', error);
    toast('error', 'Failed to update playbook. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

// Delete dialog state
const showDeleteDialog = ref(false);
const deleteDialogTitle = ref('Delete Playbook');
const deleteDialogDescription = ref('');

// Handle delete
const handleDelete = () => {
  if (!playbook.value) return;
  deleteDialogDescription.value = `Are you sure you want to delete "${playbook.value.title}"? This action cannot be undone.`;
  showDeleteDialog.value = true;
};

const confirmDelete = async () => {
  try {
    isSubmitting.value = true;
    
    await HayApi.playbooks.delete.mutate({ id: playbookId });

    toast('success', 'Playbook deleted successfully');

    await router.push('/playbooks');
  } catch (error) {
    console.error('Failed to delete playbook:', error);
    toast('error', 'Failed to delete playbook. Please try again.');
  } finally {
    isSubmitting.value = false;
    showDeleteDialog.value = false;
  }
};

// Handle cancel
const handleCancel = () => {
  router.push('/playbooks');
};

// Set page meta
definePageMeta({
  layout: 'default',
});

// Head management
useHead({
  title: 'Edit Playbook - Hay Dashboard',
  meta: [
    {
      name: 'description',
      content: 'Edit your automated conversation playbook'
    }
  ]
});
</script>