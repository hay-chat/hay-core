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
            @change="clearError(field.name)"
          />
          <span>{{ field.placeholder ?? field.label }}</span>
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

<style>
.hay-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--color-neutral-200);
  border-radius: 12px;
  font-size: 14px;
  color: var(--color-neutral-900);
}
.hay-form--submitted {
  background: var(--color-neutral-50);
}
.hay-form__title {
  font-weight: 600;
  font-size: 15px;
}
.hay-form__description,
.hay-form__summary-label {
  font-size: 13px;
  color: var(--color-neutral-500);
}
.hay-form__body,
.hay-form__summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hay-form__summary {
  gap: 4px;
}
.hay-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hay-form__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-neutral-700);
}
.hay-form__required,
.hay-form__error {
  color: #ef4444;
}
.hay-form__error {
  font-size: 12px;
}
.hay-form__input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-neutral-300);
  border-radius: 8px;
  font: inherit;
  background: #fff;
  color: inherit;
  box-sizing: border-box;
}
.hay-form__input:focus {
  outline: none;
  border-color: var(--hay-primary);
  box-shadow: 0 0 0 2px var(--hay-primary);
}
.hay-form__input--textarea {
  resize: vertical;
  min-height: 60px;
}
.hay-form__input--error,
.hay-form__input--error:focus {
  border-color: #ef4444;
  box-shadow: none;
}
.hay-form__checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.hay-form__submit {
  margin-top: 4px;
  padding: 10px 16px;
  background: var(--hay-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.hay-form__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.hay-form__summary-row {
  display: flex;
  gap: 6px;
  font-size: 13px;
}
.hay-form__summary-value {
  word-break: break-word;
}
</style>
