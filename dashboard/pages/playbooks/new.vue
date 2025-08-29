<template>
  <div class="container mx-auto max-w-4xl py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">Create New Playbook</h1>
      <p class="text-muted-foreground">
        Define automated conversation flows for your agents
      </p>
    </div>

    <Card>
      <CardContent class="p-6">
        <form @submit.prevent="handleSubmit" class="space-y-6">
          <!-- Name Field -->
          <div class="space-y-2">
            <label for="name" class="text-sm font-medium">
              Playbook Name <span class="text-red-500">*</span>
            </label>
            <Input
              id="name"
              v-model="form.name"
              placeholder="e.g., Customer Support Automation"
              :class="errors.name ? 'border-red-500' : ''"
              required
            />
            <p v-if="errors.name" class="text-sm text-red-500">
              {{ errors.name }}
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
            <label class="text-sm font-medium">Assign Agents</label>
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

          <!-- Form Actions -->
          <div class="flex justify-end space-x-4 pt-4">
            <Button
              type="button"
              variant="outline"
              @click="handleCancel"
              :disabled="isSubmitting"
            >
              Cancel
            </Button>
            <Button type="submit" :disabled="isSubmitting || !form.name">
              <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
              {{ isSubmitting ? 'Creating...' : 'Create Playbook' }}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Loader2 } from 'lucide-vue-next';
import type { PlaybookStatus, Agent } from '~/types/playbook';
import { useToast } from '~/composables/useToast';

const router = useRouter();
const { $trpc } = useNuxtApp();
const { toast } = useToast();

// Form state
const form = ref({
  name: '',
  description: '',
  instructions: '',
  status: 'draft' as PlaybookStatus,
  agentIds: [] as string[]
});

// UI state
const isSubmitting = ref(false);
const loadingAgents = ref(true);
const agents = ref<Agent[]>([]);
const errors = ref<Record<string, string>>({});

// Load agents on mount
onMounted(async () => {
  try {
    loadingAgents.value = true;
    const response = await $trpc.agents.list.query();
    agents.value = response || [];
  } catch (error) {
    console.error('Failed to load agents:', error);
    toast('error', 'Failed to load agents. Please try again.');
  } finally {
    loadingAgents.value = false;
  }
});

// Validate form
const validateForm = () => {
  errors.value = {};
  
  if (!form.value.name || form.value.name.trim().length === 0) {
    errors.value.name = 'Playbook name is required';
    return false;
  }
  
  if (form.value.name.length > 255) {
    errors.value.name = 'Playbook name must be less than 255 characters';
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
    
    const response = await $trpc.playbooks.create.mutate({
      name: form.value.name,
      description: form.value.description || undefined,
      instructions: form.value.instructions || undefined,
      status: form.value.status,
      agentIds: form.value.agentIds.length > 0 ? form.value.agentIds : undefined
    });

    toast('success', 'Playbook created successfully');

    // Navigate to the playbook edit page or list
    await router.push(`/playbooks/${response.id}/edit`);
  } catch (error) {
    console.error('Failed to create playbook:', error);
    toast('error', 'Failed to create playbook. Please try again.');
  } finally {
    isSubmitting.value = false;
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
  title: 'Create Playbook - Hay Dashboard',
  meta: [
    {
      name: 'description',
      content: 'Create a new automated conversation playbook'
    }
  ]
});
</script>