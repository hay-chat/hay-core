<template>
  <div class="space-y-6">
    <div class="flex items-start gap-3">
      <div class="p-3 rounded-lg bg-background-tertiary">
        <Package class="h-5 w-5 text-neutral-muted" />
      </div>
      <div>
        <h3 class="text-base font-medium">Connect {{ plugin.name }}</h3>
        <p class="text-sm text-neutral-muted">
          {{ plugin.description || `Provide your ${plugin.name} credentials to connect.` }}
        </p>
      </div>
    </div>

    <!-- Loading schema -->
    <div v-if="loadingSchema" class="flex items-center gap-2 text-sm text-neutral-muted">
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading configuration…
    </div>

    <!-- Schema load error -->
    <Alert v-else-if="schemaError" variant="destructive">
      <AlertTitle>Failed to load plugin configuration</AlertTitle>
      <AlertDescription>{{ schemaError }}</AlertDescription>
    </Alert>

    <!-- Form -->
    <form v-else-if="configSchema" class="space-y-4" @submit.prevent="handleSubmit">
      <div
        v-for="(field, key) in configSchema"
        v-show="evaluateShowWhen(field.showWhen, formValues)"
        :key="key"
        class="space-y-1"
      >
        <!-- Select with options -->
        <template v-if="field.options && field.options.length > 0">
          <Input
            :model-value="formValues[key] as string | undefined"
            type="select"
            :label="field.label || key"
            :options="field.options"
            :placeholder="field.placeholder"
            :hint="field.helpText"
            :data-testid="`${plugin.id}-${key}`"
            @update:model-value="(value) => (formValues[key] = value)"
          />
        </template>

        <!-- Encrypted -> password (Input handles eye toggle) -->
        <template v-else-if="field.encrypted">
          <Input
            :model-value="(formValues[key] as string | undefined) ?? ''"
            type="password"
            :label="field.label || key"
            :placeholder="field.placeholder"
            :hint="field.helpText"
            :data-testid="`${plugin.id}-${key}`"
            @update:model-value="(value) => (formValues[key] = value)"
          />
        </template>

        <!-- Plain string -->
        <template v-else>
          <Input
            :model-value="(formValues[key] as string | undefined) ?? ''"
            type="text"
            :label="field.label || key"
            :placeholder="field.placeholder"
            :hint="field.helpText"
            :data-testid="`${plugin.id}-${key}`"
            @update:model-value="(value) => (formValues[key] = value)"
          />
        </template>
      </div>

      <Alert v-if="submitError" variant="destructive">
        <AlertTitle>Could not connect</AlertTitle>
        <AlertDescription>{{ submitError }}</AlertDescription>
      </Alert>

      <div class="flex justify-end pt-2">
        <Button
          type="submit"
          :loading="submitting"
          :disabled="!canSubmit"
          :data-testid="`${plugin.id}-connect-submit`"
        >
          Connect
          <ChevronRight class="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { Package, Loader2, ChevronRight } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

interface PluginImporter {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  icon?: string;
  thumbnail?: string | null;
  connected: boolean;
  sourceIds?: string[];
  supportedFormats?: string[];
}

interface ShowWhen {
  field: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
  notEquals?: string | number | boolean;
}

interface FieldSchema {
  type?: string;
  label?: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  encrypted?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string | number }>;
  showWhen?: ShowWhen;
}

function evaluateShowWhen(rule: ShowWhen | undefined, values: Record<string, unknown>): boolean {
  if (!rule) return true;
  const current = values[rule.field];
  if (rule.equals !== undefined && current !== rule.equals) return false;
  if (rule.notEquals !== undefined && current === rule.notEquals) return false;
  if (rule.in !== undefined && !rule.in.includes(current as never)) return false;
  return true;
}

const props = defineProps<{
  plugin: PluginImporter;
}>();

const emit = defineEmits<{
  connected: [payload: { instanceId: string }];
}>();

const toast = useToast();

const loadingSchema = ref(true);
const schemaError = ref<string | null>(null);
const configSchema = ref<Record<string, FieldSchema> | null>(null);

const formValues = reactive<Record<string, unknown>>({});

const submitting = ref(false);
const submitError = ref<string | null>(null);

const canSubmit = computed(() => {
  if (!configSchema.value) return false;
  // All required fields must be non-empty — but skip required-validation for
  // fields whose `showWhen` predicate hides them from the user.
  for (const [key, field] of Object.entries(configSchema.value)) {
    if (!field.required) continue;
    if (!evaluateShowWhen(field.showWhen, formValues)) continue;
    const value = formValues[key];
    if (value === undefined || value === null || value === "") return false;
  }
  return !submitting.value;
});

onMounted(async () => {
  try {
    const data = await Hay.plugins.get.query({ pluginId: props.plugin.pluginId });
    // Prefer document_importer.configSchema, fall back to manifest.configSchema
    const manifest = (data?.manifest ?? {}) as {
      capabilities?: {
        document_importer?: {
          configSchema?: Record<string, FieldSchema>;
        };
      };
      configSchema?: Record<string, FieldSchema>;
    };
    const schema =
      manifest.capabilities?.document_importer?.configSchema ?? manifest.configSchema ?? null;

    if (!schema) {
      schemaError.value = "This plugin does not expose a configuration schema.";
      return;
    }

    configSchema.value = schema;

    // Seed defaults
    for (const [key, field] of Object.entries(schema)) {
      if (field.default !== undefined) {
        formValues[key] = field.default;
      } else {
        formValues[key] = "";
      }
    }
  } catch (err) {
    schemaError.value = err instanceof Error ? err.message : "Failed to load schema";
  } finally {
    loadingSchema.value = false;
  }
});

const handleSubmit = async () => {
  submitError.value = null;
  submitting.value = true;

  try {
    // Strip empty optional fields so the server doesn't store empty strings,
    // and drop any field whose `showWhen` hides it (the user can't have
    // intended to set it — skip serializing it).
    const configuration: Record<string, unknown> = {};
    const schema = configSchema.value ?? {};
    for (const [key, value] of Object.entries(formValues)) {
      if (value === "" || value === null || value === undefined) continue;
      if (!evaluateShowWhen(schema[key]?.showWhen, formValues)) continue;
      configuration[key] = value;
    }

    const result = await Hay.plugins.configure.mutate({
      pluginId: props.plugin.pluginId,
      configuration,
    });

    const instanceId = result?.instance?.id;
    if (!instanceId) {
      throw new Error("Server did not return a plugin instance id");
    }

    // Validate connection (best-effort — surface failures inline).
    // testConnection is MCP-specific; document_importer plugins use their own
    // tRPC routers for validation. Skip the MCP probe when the plugin doesn't
    // declare MCP capability.
    const supportsMcpProbe = Array.isArray(
      (props.plugin as { capabilities?: unknown }).capabilities,
    )
      ? ((props.plugin as { capabilities?: string[] }).capabilities ?? []).includes("mcp")
      : false;
    if (supportsMcpProbe) {
      try {
        const health = await Hay.plugins.testConnection.query({
          pluginId: props.plugin.pluginId,
        });
        if (!health.success) {
          submitError.value = health.message || "Connection test failed. Check your credentials.";
          submitting.value = false;
          return;
        }
      } catch (testErr) {
        console.warn("testConnection failed, continuing:", testErr);
      }
    }

    toast.success(`Connected to ${props.plugin.name}`);
    emit("connected", { instanceId });
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : "Connection failed";
  } finally {
    submitting.value = false;
  }
};
</script>
