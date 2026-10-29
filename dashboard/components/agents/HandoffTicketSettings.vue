<template>
  <div class="space-y-3">
    <div>
      <Label>{{ $t("agents.escalation.unavailableLabel") }}</Label>
      <p class="text-sm text-neutral-muted mt-1">
        {{ $t("agents.escalation.unavailableModeHint") }}
      </p>
    </div>

    <div class="grid gap-2 sm:grid-cols-2">
      <OptionCard
        :label="$t('agents.escalation.modeInstructions')"
        :icon="FileText"
        :checked="!modelValue"
        @click="selectInstructions"
      />
      <OptionCard
        :label="
          providers.length === 1
            ? $t('agents.escalation.modeTicketIn', { name: providers[0].name })
            : $t('agents.escalation.modeTicket')
        "
        :icon="Ticket"
        :checked="!!modelValue"
        :class="providers.length ? '' : 'opacity-60 cursor-not-allowed'"
        @click="selectTicket"
      />
    </div>

    <p v-if="!loadingProviders && !providers.length" class="text-sm text-neutral-muted">
      {{ $t("agents.escalation.noHelpdesk") }}
      <NuxtLink to="/integrations/marketplace" class="underline">
        {{ $t("agents.escalation.connectHelpdesk") }}
      </NuxtLink>
    </p>

    <div v-if="modelValue" class="rounded-lg border p-4 space-y-4">
      <p class="text-sm text-neutral-muted">{{ $t("agents.escalation.ticketExplainer") }}</p>

      <Input
        v-if="providers.length > 1"
        type="select"
        :label="$t('agents.escalation.helpdesk')"
        :options="providers.map((p) => ({ label: p.name, value: p.pluginId }))"
        :model-value="modelValue.pluginId"
        @update:model-value="selectProvider(String($event))"
      />

      <Loading v-if="loadingForm" />
      <p v-else-if="formError" class="text-sm text-destructive">{{ formError }}</p>
      <template v-else-if="formFields.length">
        <p class="text-sm font-medium">{{ $t("agents.escalation.prefillTitle") }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <template v-for="field in formFields" :key="field.key">
            <div v-if="field.type === 'multiselect'" class="sm:col-span-2 space-y-2">
              <Label>{{ field.label }}</Label>
              <div class="flex flex-wrap gap-x-4 gap-y-2">
                <label
                  v-for="option in field.options ?? []"
                  :key="option.value"
                  class="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    :model-value="multiValue(field.key).includes(option.value)"
                    @update:model-value="toggleMulti(field.key, option.value, $event)"
                  />
                  {{ option.label }}
                </label>
              </div>
            </div>
            <Input
              v-else-if="field.type === 'select'"
              type="select"
              :label="field.label"
              :hint="field.description"
              :options="[
                { label: $t('agents.escalation.notSet'), value: NOT_SET },
                ...(field.options ?? []),
              ]"
              :model-value="String(modelValue.fields[field.key] ?? NOT_SET)"
              @update:model-value="setField(field.key, $event === NOT_SET ? undefined : $event)"
            />
            <Input
              v-else-if="field.type === 'checkbox'"
              type="switch"
              :label="field.label"
              :hint="field.description"
              :model-value="modelValue.fields[field.key] === true"
              @update:model-value="setField(field.key, $event ? true : undefined)"
            />
            <Input
              v-else
              :type="field.type === 'number' ? 'number' : 'text'"
              :label="field.label"
              :hint="field.description"
              :model-value="scalarValue(field.key)"
              @update:model-value="setTextField(field.key, field.type, $event)"
            />
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { FileText, Ticket } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";

/**
 * "If all human agents are unavailable": follow the free-text instructions
 * (null) or raise a ticket in a connected helpdesk with prefilled fields. The
 * form comes from the helpdesk plugin, read from the merchant's own account.
 */
type TicketConfig = NonNullable<RouterOutputs["agents"]["get"]["human_handoff_unavailable_ticket"]>;
type FieldValue = TicketConfig["fields"][string];
type Provider = RouterOutputs["agents"]["ticketProviders"][number];
type FormField = Extract<RouterOutputs["agents"]["ticketForm"], { ok: true }>["fields"][number];

// Radix Select cannot hold an empty value, so "not set" has its own.
const NOT_SET = "__not_set__";

const props = defineProps<{ modelValue: TicketConfig | null }>();
const emit = defineEmits<{ "update:modelValue": [value: TicketConfig | null] }>();

const { t } = useI18n();
const providers = ref<Provider[]>([]);
const loadingProviders = ref(true);
const formFields = ref<FormField[]>([]);
const loadingForm = ref(false);
const formError = ref<string | null>(null);

onMounted(async () => {
  try {
    providers.value = await Hay.agents.ticketProviders.query();
  } catch {
    providers.value = [];
  } finally {
    loadingProviders.value = false;
  }
});

watch(
  () => props.modelValue?.pluginId,
  async (pluginId) => {
    formFields.value = [];
    formError.value = null;
    if (!pluginId) return;
    loadingForm.value = true;
    try {
      const form = await Hay.agents.ticketForm.query({ pluginId });
      if (form.ok) formFields.value = form.fields;
      else formError.value = t("agents.escalation.formError", { message: form.message });
    } catch (error) {
      formError.value = t("agents.escalation.formError", {
        message: error instanceof Error ? error.message : "",
      });
    } finally {
      loadingForm.value = false;
    }
  },
  { immediate: true },
);

const selectInstructions = () => emit("update:modelValue", null);

const selectTicket = () => {
  if (props.modelValue || !providers.value.length) return;
  emit("update:modelValue", { pluginId: providers.value[0].pluginId, fields: {} });
};

// Prefilled values belong to one helpdesk's fields, so switching starts over.
const selectProvider = (pluginId: string) => {
  if (pluginId !== props.modelValue?.pluginId) emit("update:modelValue", { pluginId, fields: {} });
};

const setField = (key: string, value: FieldValue | undefined) => {
  if (!props.modelValue) return;
  const fields = { ...props.modelValue.fields };
  if (value === undefined) delete fields[key];
  else fields[key] = value;
  emit("update:modelValue", { ...props.modelValue, fields });
};

const setTextField = (key: string, type: FormField["type"], value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) return setField(key, undefined);
  setField(key, type === "number" && Number.isFinite(Number(text)) ? Number(text) : text);
};

const scalarValue = (key: string): string | number | undefined => {
  const value = props.modelValue?.fields[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

const multiValue = (key: string): string[] => {
  const value = props.modelValue?.fields[key];
  return Array.isArray(value) ? value : [];
};

const toggleMulti = (key: string, option: string, checked: boolean) => {
  const current = multiValue(key).filter((value) => value !== option);
  const next = checked ? [...current, option] : current;
  setField(key, next.length ? next : undefined);
};
</script>
