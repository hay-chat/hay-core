<template>
  <div class="container mx-auto px-4 py-8 max-w-2xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Create Agent</h1>
      <p class="text-neutral-muted">Configure a new AI agent for your organization</p>
    </div>

    <form class="space-y-6" @submit.prevent="handleSubmit">
      <Card
        ><CardContent>
          <Input
            v-model="form.name"
            label="Name"
            type="text"
            required
            placeholder="Enter agent name"
          />
          <Input
            v-model="form.description"
            label="Description"
            type="textarea"
            placeholder="Describe what this agent does"
          />
          <Input
            v-model="form.instructions"
            label="Instructions"
            type="textarea"
            class="font-mono text-sm"
            placeholder="Enter agent instructions and behavior..."
          />
        </CardContent>
      </Card>

      <div>
        <Input
          v-model="form.tone"
          label="Tone"
          type="textarea"
          placeholder="Describe the communication tone (e.g., professional, friendly, casual)..."
        />

        <div class="flex flex-col gap-4 mt-4">
          <OptionCard :image="'/bale/professional.svg'" label="Professional" />
          <OptionCard :image="'/bale/casual.svg'" label="Casual" />
          <OptionCard :image="'/bale/enthusiastic.svg'" label="Enthusiastic" />
        </div>
      </div>

      <Input
        v-model="form.avoid"
        label="Things to Avoid"
        type="textarea"
        placeholder="List things the agent should avoid (e.g., technical jargon, certain topics)..."
      />

      <Input
        v-model="form.trigger"
        label="Trigger Conditions"
        type="textarea"
        placeholder="Define when this agent should be triggered (e.g., specific keywords, conditions)..."
      />

      <div class="flex items-center space-x-2">
        <Checkbox id="enabled" v-model:checked="form.enabled" />
        <label for="enabled" class="text-sm font-medium">Enable agent</label>
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
  } catch (error) {
    console.error("Failed to create agent:", error);
    toast.error((error as Error).message || "Failed to create agent");
  } finally {
    isLoading.value = false;
  }
};
</script>
