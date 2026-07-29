<template>
  <Dialog :open="open" @update:open="(v: boolean) => !v && $emit('cancel')">
    <DialogContent class="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ $t("webchat.preChatForm") }}</DialogTitle>
        <DialogDescription>
          {{ $t("webchat.preChatFormDescription") }}
        </DialogDescription>
      </DialogHeader>

      <FormSchemaEditor v-model="schema" />

      <div v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('cancel')">
          {{ $t("common.cancel") }}
        </Button>
        <Button :disabled="!validatedSchema" @click="handleSave">
          {{ $t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { formSchemaSchema, type FormSchema } from "@hay/form-schema";
import FormSchemaEditor from "@/components/forms/FormSchemaEditor.vue";

const props = defineProps<{
  open: boolean;
  initialSchema?: FormSchema | null;
}>();

const emit = defineEmits<{
  (e: "save", schema: FormSchema): void;
  (e: "cancel"): void;
}>();

function newSchema(): FormSchema {
  return {
    id: `form_${Date.now().toString(36)}`,
    title: "Untitled form",
    description: "",
    submitLabel: "Submit",
    fields: [{ name: "field_1", label: "New field", type: "text", required: true }],
  };
}

const schema = ref<FormSchema>(props.initialSchema ?? newSchema());

watch(
  () => [props.open, props.initialSchema] as const,
  ([isOpen, initial]) => {
    if (isOpen) {
      schema.value = initial ?? newSchema();
    }
  },
  { immediate: true },
);

const validatedSchema = computed<FormSchema | null>(() => {
  const parsed = formSchemaSchema.safeParse(schema.value);
  return parsed.success ? (parsed.data as FormSchema) : null;
});

const errorMessage = computed<string | null>(() => {
  const parsed = formSchemaSchema.safeParse(schema.value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid form");
});

function handleSave() {
  if (validatedSchema.value) emit("save", validatedSchema.value);
}
</script>
