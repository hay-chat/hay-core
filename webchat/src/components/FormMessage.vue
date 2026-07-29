<template>
  <div class="hay-form" :class="{ 'hay-form--submitted': submitted }">
    <div v-if="schema.title" class="hay-form__title">{{ schema.title }}</div>
    <div v-if="schema.description" class="hay-form__description">
      {{ schema.description }}
    </div>

    <form v-if="!submitted" class="hay-form__body" @submit.prevent="handleSubmit">
      <div v-for="field in schema.fields" :key="field.name" class="hay-form__field">
        <label :for="fieldId(field.name)" class="hay-form__label">
          {{ field.label }}
          <span v-if="field.required" class="hay-form__required" aria-hidden="true">*</span>
        </label>

        <input
          v-if="['text', 'email', 'phone', 'number', 'date'].includes(field.type)"
          :id="fieldId(field.name)"
          v-model="textValues[field.name]"
          :type="htmlInputType(field.type)"
          :placeholder="field.placeholder"
          :required="!!field.required"
          class="hay-form__input"
          :class="{ 'hay-form__input--error': !!errors[field.name] }"
          @input="clearError(field.name)"
        />

        <textarea
          v-else-if="field.type === 'textarea'"
          :id="fieldId(field.name)"
          v-model="textValues[field.name]"
          :placeholder="field.placeholder"
          :required="!!field.required"
          rows="3"
          class="hay-form__input hay-form__input--textarea"
          :class="{ 'hay-form__input--error': !!errors[field.name] }"
          @input="clearError(field.name)"
        ></textarea>

        <select
          v-else-if="field.type === 'select'"
          :id="fieldId(field.name)"
          v-model="textValues[field.name]"
          :required="!!field.required"
          class="hay-form__input hay-form__input--select"
          :class="{ 'hay-form__input--error': !!errors[field.name] }"
          @change="clearError(field.name)"
        >
          <option value="" disabled>{{ field.placeholder ?? "—" }}</option>
          <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

        <label
          v-else-if="field.type === 'checkbox'"
          class="hay-form__checkbox-row"
          :for="fieldId(field.name)"
        >
          <input
            :id="fieldId(field.name)"
            v-model="boolValues[field.name]"
            type="checkbox"
            class="hay-form__checkbox"
            @change="clearError(field.name)"
          />
          <span class="hay-form__checkbox-label">{{ field.placeholder ?? field.label }}</span>
        </label>

        <div v-if="errors[field.name]" class="hay-form__error">
          {{ errors[field.name] }}
        </div>
      </div>

      <button type="submit" class="hay-form__submit" :disabled="submitting">
        {{ submitting ? "…" : (schema.submitLabel ?? "Submit") }}
      </button>
    </form>

    <div v-else class="hay-form__summary">
      <div v-for="field in schema.fields" :key="field.name" class="hay-form__summary-row">
        <span class="hay-form__summary-label">{{ field.label }}:</span>
        <span class="hay-form__summary-value">{{ formatSubmittedValue(field) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import type { FormField, FormSchema, FormResponse } from "@hay/form-schema";
import { validateResponse } from "@hay/form-schema";

const props = defineProps<{
  schema: FormSchema;
  initialValues?: Record<string, unknown>;
  submitted?: boolean;
  submittedResponse?: FormResponse;
}>();

const emit = defineEmits<{
  (e: "submit", response: FormResponse): void;
}>();

type FormValue = string | number | boolean | null;
const submitting = ref(false);
const errors = reactive<Record<string, string>>({});
const textValues = reactive<Record<string, string>>({});
const boolValues = reactive<Record<string, boolean>>({});

function initializeValues() {
  for (const field of props.schema.fields) {
    const initial = props.initialValues?.[field.name];
    if (field.type === "checkbox") {
      boolValues[field.name] = initial === true;
    } else {
      textValues[field.name] = initial === undefined || initial === null ? "" : String(initial);
    }
  }
}

initializeValues();

watch(
  () => props.schema.id,
  () => initializeValues(),
);

function fieldId(name: string): string {
  return `hay-form-${props.schema.id}-${name}`;
}

function htmlInputType(type: FormField["type"]): string {
  switch (type) {
    case "email":
      return "email";
    case "phone":
      return "tel";
    case "number":
      return "number";
    case "date":
      return "date";
    default:
      return "text";
  }
}

function clearError(name: string) {
  if (errors[name]) delete errors[name];
}

function coerceValues(): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const field of props.schema.fields) {
    if (field.type === "checkbox") {
      out[field.name] = !!boolValues[field.name];
      continue;
    }
    const raw = textValues[field.name];
    if (field.type === "number") {
      out[field.name] = raw === "" || raw == null ? null : Number(raw);
    } else {
      out[field.name] = raw === "" || raw == null ? null : raw;
    }
  }
  return out;
}

async function handleSubmit() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  const coerced = coerceValues();
  const result = validateResponse(props.schema, coerced);
  if (!result.success) {
    Object.assign(errors, result.errors);
    return;
  }
  submitting.value = true;
  try {
    emit("submit", result.data);
  } finally {
    submitting.value = false;
  }
}

function formatSubmittedValue(field: FormField): string {
  const raw = props.submittedResponse?.[field.name];
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (field.type === "select") {
    const opt = field.options?.find((o) => o.value === raw);
    if (opt) return opt.label;
  }
  return String(raw);
}
</script>

<style scoped>
.hay-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--hay-form-bg, #ffffff);
  border: 1px solid var(--hay-form-border, #e5e7eb);
  border-radius: 12px;
  font-size: 14px;
  color: var(--hay-form-text, #111827);
}

.hay-form__title {
  font-weight: 600;
  font-size: 15px;
}

.hay-form__description {
  font-size: 13px;
  color: var(--hay-form-muted, #6b7280);
}

.hay-form__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hay-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hay-form__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--hay-form-label, #374151);
}

.hay-form__required {
  color: #ef4444;
  margin-left: 2px;
}

.hay-form__input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--hay-form-input-border, #d1d5db);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  background: #fff;
  color: inherit;
  box-sizing: border-box;
}

.hay-form__input:focus {
  outline: none;
  border-color: var(--hay-primary, #4f46e5);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
}

.hay-form__input--textarea {
  resize: vertical;
  min-height: 60px;
}

.hay-form__input--error {
  border-color: #ef4444;
}

.hay-form__input--error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}

.hay-form__checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.hay-form__checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.hay-form__checkbox-label {
  font-size: 14px;
}

.hay-form__error {
  color: #ef4444;
  font-size: 12px;
}

.hay-form__submit {
  margin-top: 4px;
  padding: 10px 16px;
  background: var(--hay-primary, #4f46e5);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.hay-form__submit:hover:not(:disabled) {
  background: var(--hay-primary-hover, #4338ca);
}

.hay-form__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hay-form__summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hay-form__summary-row {
  display: flex;
  gap: 6px;
  font-size: 13px;
}

.hay-form__summary-label {
  color: var(--hay-form-muted, #6b7280);
  font-weight: 500;
}

.hay-form__summary-value {
  color: inherit;
  word-break: break-word;
}

.hay-form--submitted {
  background: var(--hay-form-submitted-bg, #f9fafb);
}
</style>
