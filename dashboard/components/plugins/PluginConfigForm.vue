<template>
  <form @submit.prevent="$emit('submit')" class="space-y-4">
    <div
      v-for="(field, key) in configSchema"
      v-show="evaluateShowWhen(field.showWhen, formData)"
      :key="key"
      class="space-y-2"
      :id="key"
    >
      <!-- Text Input -->
      <template v-if="field.type === 'string' && !field.options">
        <Label :for="key" :required="field.required">
          {{ fieldLabel(key, field) }}
          <Lock v-if="field.encrypted" class="inline-block h-3 w-3 ml-1 text-neutral-muted" />
        </Label>
        <p v-if="fieldDescription(key, field)" class="text-xs text-neutral-muted !mt-0">
          {{ fieldDescription(key, field) }}
        </p>

        <!-- Environment variable field (not yet overridden) -->
        <div
          v-if="
            configMetadata?.[key]?.source === 'env' &&
            configMetadata[key]?.canOverride &&
            !editingEnvFields.has(key)
          "
          class="space-y-2"
        >
          <div class="flex items-center space-x-2">
            <Input
              :id="key"
              :value="t('pluginSettings.form.managedValue')"
              type="text"
              disabled
              class="flex-1 bg-muted"
            />
            <Button type="button" variant="outline" @click="handleEditEnvField(key)">
              <Edit3 class="h-4 w-4 mr-1" />
              {{ t("pluginSettings.form.override") }}
            </Button>
          </div>
          <p class="text-xs text-neutral-muted">
            {{ t("pluginSettings.form.managedHint") }}
          </p>
        </div>

        <!-- Environment variable field being edited (override mode) -->
        <div
          v-else-if="
            configMetadata?.[key]?.source === 'env' &&
            configMetadata[key]?.canOverride &&
            editingEnvFields.has(key)
          "
          class="space-y-2"
        >
          <div class="flex items-center space-x-2">
            <Input
              :id="key"
              :model-value="formData[key]"
              @update:model-value="updateFormData(key, $event)"
              :type="field.encrypted ? 'password' : 'text'"
              :placeholder="fieldPlaceholder(key, field)"
              :required="field.required"
              class="flex-1"
              autofocus
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              :aria-label="t('pluginSettings.form.cancelOverride')"
              @click="handleCancelEditEnvField(key)"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
          <p class="text-xs text-neutral-muted">
            {{ t("pluginSettings.form.overridingHint") }}
          </p>
        </div>

        <!-- Encrypted field with edit mode -->
        <!-- Show for database-sourced encrypted fields only -->
        <div
          v-if="
            field.encrypted &&
            originalFormData[key] !== undefined &&
            originalFormData[key] !== '' &&
            originalFormData[key] !== null &&
            configMetadata?.[key]?.source === 'database'
          "
          class="space-y-2"
        >
          <div v-if="!editingEncryptedFields.has(key)" class="flex items-center space-x-2">
            <Input
              :id="key"
              :value="t('pluginSettings.form.encryptedValue')"
              type="text"
              disabled
              class="flex-1 bg-muted"
            />
            <Button type="button" variant="outline" @click="handleEditEncryptedField(key)">
              <Edit3 class="h-4 w-4 mr-1" />
              {{ t("pluginSettings.form.edit") }}
            </Button>
            <!-- Show Reset button if field has env fallback -->
            <Button
              v-if="configMetadata?.[key]?.hasEnvFallback"
              type="button"
              variant="ghost"
              @click="handleResetToEnv(key)"
            >
              <RotateCcw class="h-4 w-4 mr-1" />
              {{ t("pluginSettings.form.resetToManaged") }}
            </Button>
          </div>

          <div v-else class="flex items-center space-x-2">
            <Input
              :id="key"
              :model-value="formData[key]"
              @update:model-value="updateFormData(key, $event)"
              type="password"
              :placeholder="fieldPlaceholder(key, field)"
              :required="field.required"
              class="flex-1"
              autofocus
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              :aria-label="t('pluginSettings.form.cancelEdit')"
              @click="handleCancelEditEncryptedField(key)"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
          <p class="text-xs text-neutral-muted">
            {{
              configMetadata?.[key]?.hasEnvFallback
                ? t("pluginSettings.form.encryptedResetHint")
                : t("pluginSettings.form.encryptedHint")
            }}
          </p>
        </div>

        <!-- Non-encrypted database field with env fallback (show with reset button) -->
        <div
          v-else-if="
            !field.encrypted &&
            configMetadata?.[key]?.source === 'database' &&
            configMetadata?.[key]?.hasEnvFallback
          "
          class="space-y-2"
        >
          <div class="flex items-center space-x-2">
            <Input
              :id="key"
              :model-value="formData[key]"
              @update:model-value="updateFormData(key, $event)"
              type="text"
              :placeholder="fieldPlaceholder(key, field)"
              :required="field.required"
              class="flex-1"
            />
            <Button type="button" variant="ghost" @click="handleResetToEnv(key)">
              <RotateCcw class="h-4 w-4 mr-1" />
              {{ t("pluginSettings.form.resetToManaged") }}
            </Button>
          </div>
          <p class="text-xs text-neutral-muted">
            {{ t("pluginSettings.form.overrideResetHint") }}
          </p>
        </div>

        <!-- Regular input or empty encrypted field (first time) -->
        <!-- Don't show if it's an env-sourced field (already handled above) -->
        <div
          v-else-if="
            (field.encrypted || !field.encrypted) && configMetadata?.[key]?.source !== 'env'
          "
        >
          <Input
            :id="key"
            :model-value="formData[key]"
            @update:model-value="updateFormData(key, $event)"
            :type="field.encrypted ? 'password' : 'text'"
            :placeholder="fieldPlaceholder(key, field)"
            :required="field.required"
          />
          <p v-if="field.encrypted" class="text-xs text-neutral-muted mt-1">
            {{ t("pluginSettings.form.willEncrypt") }}
          </p>
        </div>
      </template>

      <!-- Select -->
      <template v-else-if="field.type === 'select' || field.options">
        <Label :for="key" :required="field.required">
          {{ fieldLabel(key, field) }}
        </Label>
        <p v-if="fieldDescription(key, field)" class="text-xs mt-0 text-neutral-muted">
          {{ fieldDescription(key, field) }}
        </p>
        <Select :model-value="formData[key]" @update:model-value="updateFormData(key, $event)">
          <SelectTrigger :id="key" class="w-full">
            <SelectValue :placeholder="t('pluginSettings.form.selectPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in field.options" :key="option.value" :value="option.value">
              {{ optionLabel(key, option) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </template>

      <!-- Boolean -->
      <template v-else-if="field.type === 'boolean'">
        <div class="flex items-center justify-between space-x-2">
          <div class="space-y-0.5">
            <Label :for="key">{{ fieldLabel(key, field) }}</Label>
            <p v-if="fieldDescription(key, field)" class="text-xs text-neutral-muted">
              {{ fieldDescription(key, field) }}
            </p>
          </div>
          <Switch
            :id="key"
            :model-value="formData[key]"
            @update:model-value="updateFormData(key, $event)"
          />
        </div>
      </template>

      <!-- Textarea -->
      <template v-else-if="field.type === 'textarea'">
        <Label :for="key" :required="field.required">
          {{ fieldLabel(key, field) }}
        </Label>
        <p v-if="fieldDescription(key, field)" class="text-xs text-neutral-muted">
          {{ fieldDescription(key, field) }}
        </p>
        <Textarea
          :id="key"
          :model-value="formData[key]"
          @update:model-value="updateFormData(key, $event)"
          :placeholder="fieldPlaceholder(key, field)"
          :rows="4"
          :required="field.required"
        />
      </template>

      <!-- Number -->
      <template v-else-if="field.type === 'number'">
        <Label :for="key" :required="field.required">
          {{ fieldLabel(key, field) }}
        </Label>
        <p v-if="fieldDescription(key, field)" class="text-xs text-neutral-muted">
          {{ fieldDescription(key, field) }}
        </p>
        <Input
          :id="key"
          :model-value="formData[key]"
          @update:model-value="updateFormData(key, $event === '' ? undefined : Number($event))"
          type="number"
          :placeholder="fieldPlaceholder(key, field)"
          :required="field.required"
        />
      </template>
    </div>

    <div class="flex justify-end space-x-2 pt-4">
      <Button type="button" variant="outline" @click="$emit('reset')">
        {{ t("pluginSettings.form.discard") }}
      </Button>
      <Button type="submit" :loading="saving">{{ t("pluginSettings.form.save") }}</Button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { Lock, Edit3, X, RotateCcw } from "lucide-vue-next";
import { useToolLabel } from "@/composables/useToolLabel";

interface ShowWhen {
  field: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
  notEquals?: string | number | boolean;
}

interface FieldSchema {
  type: "string" | "select" | "boolean" | "textarea" | "number";
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  encrypted?: boolean;
  env?: string;
  options?: Array<{ value: string; label: string }>;
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

interface ConfigFieldMetadata {
  source: "env" | "database" | "default";
  canOverride: boolean;
  isEncrypted: boolean;
  hasEnvFallback?: boolean;
}

interface Props {
  /** Plugin id, for its translated field labels (`plugins.<id>.config.<field>.*`). */
  pluginId: string;
  configSchema: Record<string, FieldSchema>;
  formData: Record<string, any>;
  originalFormData: Record<string, any>;
  editingEncryptedFields: Set<string>;
  configMetadata?: Record<string, ConfigFieldMetadata>;
  saving?: boolean;
}

const props = defineProps<Props>();

const { t } = useI18n();
const { getConfigLabel, getConfigDescription, getConfigOptionLabel, getConfigPlaceholder } =
  useToolLabel();

const fieldLabel = (key: string, field: FieldSchema) =>
  getConfigLabel(props.pluginId, key, field.label);
const fieldDescription = (key: string, field: FieldSchema) =>
  getConfigDescription(props.pluginId, key, field.description);
const fieldPlaceholder = (key: string, field: FieldSchema) =>
  getConfigPlaceholder(props.pluginId, key, field.placeholder) || undefined;
const optionLabel = (key: string, option: { value: string; label: string }) =>
  getConfigOptionLabel(props.pluginId, key, option.value, option.label);

const editingEnvFields = ref<Set<string>>(new Set());

const emit = defineEmits<{
  "update:formData": [value: Record<string, any>];
  "update:editingEncryptedFields": [value: Set<string>];
  "update:editingEnvFields": [value: Set<string>];
  submit: [];
  reset: [];
  "reset-to-env": [key: string];
}>();

function updateFormData(key: string, value: any) {
  emit("update:formData", { ...props.formData, [key]: value });
}

function handleEditEncryptedField(key: string) {
  const newSet = new Set(props.editingEncryptedFields);
  newSet.add(key);
  emit("update:editingEncryptedFields", newSet);
  // Clear the masked value
  updateFormData(key, "");
}

function handleCancelEditEncryptedField(key: string) {
  const newSet = new Set(props.editingEncryptedFields);
  newSet.delete(key);
  emit("update:editingEncryptedFields", newSet);
  // Restore masked value
  updateFormData(key, props.originalFormData[key]);
}

function handleEditEnvField(key: string) {
  const newSet = new Set(editingEnvFields.value);
  newSet.add(key);
  editingEnvFields.value = newSet;
  emit("update:editingEnvFields", newSet);
  // Clear the value to allow user to enter their own
  updateFormData(key, "");
}

function handleCancelEditEnvField(key: string) {
  // Validate that the field exists in configSchema
  if (!props.configSchema[key]) {
    console.error(`Cannot cancel edit for non-existent field: ${key}`);
    return;
  }

  // Validate that it's actually an env field
  if (props.configMetadata?.[key]?.source !== "env") {
    console.error(`Cannot cancel edit for non-env field: ${key}`);
    return;
  }

  const newSet = new Set(editingEnvFields.value);
  newSet.delete(key);
  editingEnvFields.value = newSet;
  emit("update:editingEnvFields", newSet);
  // Remove from formData to revert to env
  const newFormData = { ...props.formData };
  delete newFormData[key];
  emit("update:formData", newFormData);
}

function handleResetToEnv(key: string) {
  // Validate that the field exists in configSchema
  if (!props.configSchema[key]) {
    console.error(`Cannot reset non-existent field: ${key}`);
    return;
  }

  // Validate that the field has an env fallback
  if (!props.configMetadata?.[key]?.hasEnvFallback) {
    console.error(`Cannot reset field without env fallback: ${key}`);
    return;
  }

  // Emit event to parent to handle the reset and save
  emit("reset-to-env", key);
}
</script>
