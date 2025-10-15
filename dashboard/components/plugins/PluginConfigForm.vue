<template>
  <form @submit.prevent="$emit('submit')" class="space-y-4">
    <div v-for="(field, key) in configSchema" :key="key" class="space-y-2" :id="key">
      <!-- Text Input -->
      <template v-if="field.type === 'string' && !field.options">
        <Label :for="key" :required="field.required">
          {{ field.label || key }}
          <Lock v-if="field.encrypted" class="inline-block h-3 w-3 ml-1 text-neutral-muted" />
        </Label>
        <p v-if="field.description" class="text-sm text-neutral-muted">
          {{ field.description }}
        </p>

        <!-- Encrypted field with edit mode -->
        <div
          v-if="field.encrypted && originalFormData[key] && /^\*+$/.test(originalFormData[key])"
          class="space-y-2"
        >
          <div v-if="!editingEncryptedFields.has(key)" class="flex items-center space-x-2">
            <Input
              :id="key"
              value="••••••••"
              type="password"
              disabled
              class="flex-1 bg-muted"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              @click="handleEditEncryptedField(key)"
            >
              <Edit3 class="h-4 w-4 mr-1" />
              Edit
            </Button>
          </div>

          <div v-else class="flex items-center space-x-2">
            <Input
              :id="key"
              :model-value="formData[key]"
              @update:model-value="updateFormData(key, $event)"
              type="password"
              :placeholder="'Enter new ' + (field.label || key).toLowerCase()"
              :required="field.required"
              class="flex-1"
              autofocus
            />
            <Button type="button" size="sm" variant="ghost" @click="handleCancelEditEncryptedField(key)">
              <X class="h-4 w-4" />
            </Button>
          </div>
          <p class="text-xs text-neutral-muted">
            This value is encrypted and stored securely. Click edit to update it.
          </p>
        </div>

        <!-- Regular input or new encrypted field -->
        <div v-else>
          <Input
            :id="key"
            :model-value="formData[key]"
            @update:model-value="updateFormData(key, $event)"
            :type="field.encrypted ? 'password' : 'text'"
            :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
            :required="field.required"
          />
          <p v-if="field.encrypted" class="text-xs text-neutral-muted mt-1">
            This value will be encrypted and stored securely.
          </p>
        </div>
      </template>

      <!-- Select -->
      <template v-else-if="field.type === 'select' || field.options">
        <Label :for="key" :required="field.required">
          {{ field.label || key }}
        </Label>
        <p v-if="field.description" class="text-sm text-neutral-muted">
          {{ field.description }}
        </p>
        <select
          :id="key"
          :value="formData[key]"
          @input="updateFormData(key, ($event.target as HTMLSelectElement).value)"
          class="w-full px-3 py-2 text-sm border border-input rounded-md"
          :required="field.required"
        >
          <option value="">Select {{ (field.label || key).toLowerCase() }}</option>
          <option v-for="option in field.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </template>

      <!-- Boolean -->
      <template v-else-if="field.type === 'boolean'">
        <div class="flex items-center justify-between space-x-2">
          <div class="space-y-0.5">
            <Label :for="key">{{ field.label || key }}</Label>
            <p v-if="field.description" class="text-sm text-neutral-muted">
              {{ field.description }}
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
          {{ field.label || key }}
        </Label>
        <p v-if="field.description" class="text-sm text-neutral-muted">
          {{ field.description }}
        </p>
        <Textarea
          :id="key"
          :model-value="formData[key]"
          @update:model-value="updateFormData(key, $event)"
          :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
          :rows="4"
          :required="field.required"
        />
      </template>

      <!-- Number -->
      <template v-else-if="field.type === 'number'">
        <Label :for="key" :required="field.required">
          {{ field.label || key }}
        </Label>
        <p v-if="field.description" class="text-sm text-neutral-muted">
          {{ field.description }}
        </p>
        <Input
          :id="key"
          :model-value="formData[key]"
          @update:model-value="updateFormData(key, $event === '' ? undefined : Number($event))"
          type="number"
          :placeholder="field.placeholder || 'Enter ' + (field.label || key).toLowerCase()"
          :required="field.required"
        />
      </template>
    </div>

    <div class="flex justify-end space-x-2 pt-4">
      <Button type="button" variant="outline" @click="$emit('reset')"> Reset </Button>
      <Button type="submit" :disabled="saving" :loading="saving">
        Save Configuration
      </Button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { Lock, Edit3, X } from "lucide-vue-next";

interface FieldSchema {
  type: "string" | "select" | "boolean" | "textarea" | "number";
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  encrypted?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface Props {
  configSchema: Record<string, FieldSchema>;
  formData: Record<string, any>;
  originalFormData: Record<string, any>;
  editingEncryptedFields: Set<string>;
  saving?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:formData": [value: Record<string, any>];
  "update:editingEncryptedFields": [value: Set<string>];
  submit: [];
  reset: [];
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
</script>
