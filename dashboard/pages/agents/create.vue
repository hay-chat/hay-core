<template>
  <div class="container mx-auto px-4 py-8 max-w-2xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Create Agent</h1>
      <p class="text-muted-foreground">
Configure a new AI agent for your organization
</p>
    </div>

    <form class="space-y-6" @submit.prevent="handleSubmit">
      <div>
        <label for="name"
class="block text-sm font-medium mb-2">Name</label>
        <input
          id="name"
          v-model="form.name"
          type="text"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Enter agent name"
        />
      </div>

      <div>
        <label for="description"
class="block text-sm font-medium mb-2">Description</label>
        <textarea
          id="description"
          v-model="form.description"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Describe what this agent does"
        />
      </div>

      <div>
        <label for="instructions"
class="block text-sm font-medium mb-2">Instructions</label>
        <textarea
          id="instructions"
          v-model="form.instructions"
          rows="6"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
          placeholder="Enter agent instructions and behavior..."
        />
      </div>

      <div>
        <label for="tone"
class="block text-sm font-medium mb-2">Tone</label>
        <textarea
          id="tone"
          v-model="form.tone"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Describe the communication tone (e.g., professional, friendly, casual)..."
        />
      </div>

      <div>
        <label for="avoid"
class="block text-sm font-medium mb-2">Things to Avoid</label>
        <textarea
          id="avoid"
          v-model="form.avoid"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="List things the agent should avoid (e.g., technical jargon, certain topics)..."
        />
      </div>

      <div>
        <label for="trigger"
class="block text-sm font-medium mb-2">Trigger Conditions</label>
        <textarea
          id="trigger"
          v-model="form.trigger"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Define when this agent should be triggered (e.g., specific keywords, conditions)..."
        />
      </div>

      <div class="flex items-center space-x-2">
        <input
          id="enabled"
          v-model="form.enabled"
          type="checkbox"
          class="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
        />
        <label for="enabled"
class="text-sm font-medium">Enable agent</label>
      </div>

      <div class="flex gap-4">
        <button
          type="submit"
          :disabled="isLoading"
          class="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ isLoading ? "Creating..." : "Create Agent" }}
        </button>
        <NuxtLink to="/agents" class="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "@/composables/useToast";
import { HayApi } from "@/utils/api";

const router = useRouter();
const toast = useToast();

const isLoading = ref(false);
const form = ref({
  name: "",
  description: "",
  instructions: "",
  tone: "",
  avoid: "",
  trigger: "",
  enabled: true,
});

const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    toast.error("Agent name is required");
    return;
  }

  isLoading.value = true;

  try {
    await HayApi.agents.create.mutate({
      name: form.value.name,
      description: form.value.description || undefined,
      instructions: form.value.instructions || undefined,
      tone: form.value.tone || undefined,
      avoid: form.value.avoid || undefined,
      trigger: form.value.trigger || undefined,
      enabled: form.value.enabled,
    });

    toast.success("Agent created successfully");
    await router.push("/agents");
  } catch (error: any) {
    console.error("Failed to create agent:", error);
    toast.error(error.message || "Failed to create agent");
  } finally {
    isLoading.value = false;
  }
};
</script>
