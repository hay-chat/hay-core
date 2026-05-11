<template>
  <div class="hay-pre-chat">
    <FormMessage :schema="effectiveSchema" :initial-values="initialValues" @submit="handleSubmit" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FormResponse, FormSchema } from "@hay/form-schema";
import FormMessage from "./FormMessage.vue";

const props = defineProps<{
  schema: FormSchema;
  context?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: "submit", response: FormResponse): void;
  (e: "skip"): void;
}>();

const effectiveSchema = computed<FormSchema>(() => {
  const ctx = props.context ?? {};
  const filtered = props.schema.fields.filter((f) => {
    const value = ctx[f.name];
    return value === undefined || value === null || value === "";
  });
  return { ...props.schema, fields: filtered };
});

const initialValues = computed<Record<string, unknown>>(() => {
  return { ...(props.context ?? {}) };
});

if (effectiveSchema.value.fields.length === 0) {
  Promise.resolve().then(() => emit("skip"));
}

function handleSubmit(response: FormResponse) {
  const merged: FormResponse = { ...response };
  const ctx = props.context ?? {};
  for (const field of props.schema.fields) {
    if (merged[field.name] !== undefined) continue;
    const value = ctx[field.name];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      merged[field.name] = value;
    }
  }
  emit("submit", merged);
}
</script>

<style scoped>
.hay-pre-chat {
  padding: 8px;
}
</style>
