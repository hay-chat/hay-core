<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <Label>What actions can this playbook take?</Label>
      <p class="text-sm text-neutral-muted">
        Select the tools this playbook is allowed to use. If none are selected, the playbook will be
        answer-only.
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="h-12 rounded-lg bg-muted animate-pulse" />
    </div>

    <!-- Error state -->
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription> Failed to load available tools. Please try again later. </AlertDescription>
    </Alert>

    <!-- No tools available -->
    <Alert v-else-if="tools.length === 0" variant="info" :icon="Info">
      <AlertDescription>
        No integrations are connected yet. This playbook will be answer-only unless you connect
        integrations in Settings.
      </AlertDescription>
    </Alert>

    <!-- Grouped tools -->
    <div v-else class="space-y-6">
      <div v-for="group in groupedTools" :key="group.pluginName" class="space-y-2">
        <p class="text-sm font-medium text-foreground">{{ group.pluginName }}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <OptionCard
            v-for="tool in group.tools"
            :key="tool.id"
            :label="tool.label"
            :checked="isSelected(tool)"
            @click="toggleTool(tool)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Info } from "lucide-vue-next";
import { HayApi } from "@/utils/api";

interface MCPTool {
  id: string;
  name: string;
  label: string;
  description: string;
  pluginId: string;
  pluginName: string;
}

interface SelectedAction {
  name: string;
  description: string;
  pluginName: string;
}

const props = defineProps<{
  modelValue: SelectedAction[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: SelectedAction[]];
}>();

const tools = ref<MCPTool[]>([]);
const loading = ref(false);
const error = ref(false);

const groupedTools = computed(() => {
  const groups = new Map<string, MCPTool[]>();
  for (const tool of tools.value) {
    const existing = groups.get(tool.pluginName);
    if (existing) {
      existing.push(tool);
    } else {
      groups.set(tool.pluginName, [tool]);
    }
  }
  return Array.from(groups.entries()).map(([pluginName, pluginTools]) => ({
    pluginName,
    tools: pluginTools,
  }));
});

function isSelected(tool: MCPTool): boolean {
  return props.modelValue.some((a) => a.name === tool.name && a.pluginName === tool.pluginName);
}

function toggleTool(tool: MCPTool) {
  const idx = props.modelValue.findIndex(
    (a) => a.name === tool.name && a.pluginName === tool.pluginName,
  );
  if (idx >= 0) {
    const next = [...props.modelValue];
    next.splice(idx, 1);
    emit("update:modelValue", next);
  } else {
    emit("update:modelValue", [
      ...props.modelValue,
      { name: tool.name, description: tool.description, pluginName: tool.pluginName },
    ]);
  }
}

onMounted(async () => {
  loading.value = true;
  error.value = false;
  try {
    tools.value = await HayApi.plugins.getMCPTools.query();
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
