<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between gap-4">
        <div>
          <CardTitle>{{ $t("webchat.preChatForm") }}</CardTitle>
          <CardDescription>{{ $t("webchat.preChatFormDescription") }}</CardDescription>
        </div>
        <div class="flex items-center gap-2">
          <Switch id="preChatFormEnabled" v-model:checked="enabled" />
          <Label for="preChatFormEnabled">{{ $t("common.enabled") }}</Label>
        </div>
      </div>
    </CardHeader>

    <CardContent v-if="enabled" class="space-y-4">
      <FormSchemaEditor v-model="schema" />
      <div v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { formSchemaSchema, type FormSchema } from "@hay/form-schema";
import FormSchemaEditor from "@/components/forms/FormSchemaEditor.vue";

const props = defineProps<{
  modelValue: FormSchema | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: FormSchema | null): void;
}>();

function emptySchema(): FormSchema {
  return {
    id: "pre-chat",
    title: "Before we start",
    description: "",
    submitLabel: "Start chat",
    fields: [
      { name: "name", label: "Name", type: "text", required: true, mapToCustomer: "name" },
      { name: "email", label: "Email", type: "email", required: true, mapToCustomer: "email" },
    ],
  };
}

const enabled = ref<boolean>(props.modelValue !== null);
const schema = ref<FormSchema>(props.modelValue ?? emptySchema());
const errorMessage = ref<string | null>(null);

watch(
  () => props.modelValue,
  (next) => {
    enabled.value = next !== null;
    if (next) schema.value = next;
  },
);

// Emit the form only while it is valid; an invalid draft keeps the last
// emitted value and shows why it is not saved.
watch(
  [enabled, schema],
  () => {
    if (!enabled.value) {
      errorMessage.value = null;
      emit("update:modelValue", null);
      return;
    }
    const parsed = formSchemaSchema.safeParse(schema.value);
    errorMessage.value = parsed.success
      ? null
      : (parsed.error.issues[0]?.message ?? "Invalid form");
    if (parsed.success) emit("update:modelValue", parsed.data as FormSchema);
  },
  { deep: true },
);

watch(enabled, (next) => {
  if (next && schema.value.fields.length === 0) {
    schema.value = emptySchema();
  }
});
</script>
