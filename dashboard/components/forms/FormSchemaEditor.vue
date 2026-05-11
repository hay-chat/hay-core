<template>
  <div class="space-y-4">
    <div class="grid gap-4 md:grid-cols-2">
      <Input
        :id="`form-title-${uid}`"
        :model-value="modelValue.title"
        :label="$t('webchat.preChatFormTitle')"
        :placeholder="$t('webchat.preChatFormTitlePlaceholder')"
        @update:model-value="(v: string | number | boolean) => update({ title: String(v) })"
      />
      <Input
        :id="`form-submit-label-${uid}`"
        :model-value="modelValue.submitLabel"
        :label="$t('webchat.preChatFormSubmitLabel')"
        :placeholder="$t('webchat.preChatFormSubmitLabelPlaceholder')"
        @update:model-value="(v: string | number | boolean) => update({ submitLabel: String(v) })"
      />
    </div>

    <Textarea
      :id="`form-description-${uid}`"
      :model-value="modelValue.description"
      :label="$t('webchat.preChatFormFormDescription')"
      :placeholder="$t('webchat.preChatFormFormDescriptionPlaceholder')"
      :rows="2"
      @update:model-value="(v: string | number | boolean) => update({ description: String(v) })"
    />

    <div class="space-y-2">
      <Label>{{ $t("webchat.preChatFormFields") }}</Label>

      <div
        v-for="(field, index) in modelValue.fields"
        :key="`${field.name}-${index}`"
        class="rounded-lg border bg-card p-4 space-y-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-muted-foreground">
            #{{ index + 1 }} — {{ field.label || $t("webchat.preChatFormUntitled") }}
          </span>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="sm" :disabled="index === 0" @click="moveField(index, -1)">
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :disabled="index === modelValue.fields.length - 1"
              @click="moveField(index, 1)"
            >
              ↓
            </Button>
            <Button variant="ghost" size="sm" @click="removeField(index)">
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <Input
            :id="`field-label-${uid}-${index}`"
            :model-value="field.label"
            :label="$t('webchat.preChatFormFieldLabel')"
            :placeholder="$t('webchat.preChatFormFieldLabelPlaceholder')"
            @update:model-value="
              (v: string | number | boolean) =>
                updateField(index, { label: String(v), name: maybeAutoSlug(field, String(v)) })
            "
          />

          <div class="space-y-2">
            <Label :for="`field-key-${uid}-${index}`">
              {{ $t("webchat.preChatFormFieldKey") }}
            </Label>
            <Input
              :id="`field-key-${uid}-${index}`"
              :model-value="field.name"
              @update:model-value="
                (v: string | number | boolean) => updateField(index, { name: String(v) })
              "
            />
          </div>

          <div class="space-y-2">
            <Label :for="`field-type-${uid}-${index}`">
              {{ $t("webchat.preChatFormFieldType") }}
            </Label>
            <Select
              :model-value="field.type"
              @update:model-value="(v: unknown) => updateFieldType(index, v)"
            >
              <SelectTrigger :id="`field-type-${uid}-${index}`">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="t in fieldTypes" :key="t" :value="t">{{ t }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label :for="`field-customer-${uid}-${index}`">
              {{ $t("webchat.preChatFormFieldMapToCustomer") }}
            </Label>
            <Select
              :model-value="field.mapToCustomer ?? 'none'"
              @update:model-value="(v: unknown) => updateMapToCustomer(index, v)"
            >
              <SelectTrigger :id="`field-customer-${uid}-${index}`">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="name">name</SelectItem>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="phone">phone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Switch
            :id="`field-required-${uid}-${index}`"
            :checked="!!field.required"
            @update:checked="(v: boolean) => updateField(index, { required: v })"
          />
          <Label :for="`field-required-${uid}-${index}`">{{
            $t("webchat.preChatFormFieldRequired")
          }}</Label>
        </div>

        <div v-if="field.type === 'select'" class="space-y-2">
          <Label>{{ $t("webchat.preChatFormFieldOptions") }}</Label>
          <div v-for="(opt, oi) in field.options ?? []" :key="oi" class="flex items-center gap-2">
            <Input
              :model-value="opt.label"
              placeholder="Label"
              class="flex-1"
              @update:model-value="
                (v: string | number | boolean) => updateOption(index, oi, { label: String(v) })
              "
            />
            <Input
              :model-value="opt.value"
              placeholder="value"
              class="flex-1"
              @update:model-value="
                (v: string | number | boolean) => updateOption(index, oi, { value: String(v) })
              "
            />
            <Button variant="ghost" size="sm" @click="removeOption(index, oi)">
              <X class="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addOption(index)">
            + {{ $t("webchat.preChatFormFieldAddOption") }}
          </Button>
        </div>
      </div>

      <Button variant="outline" size="sm" @click="addField">
        + {{ $t("webchat.preChatFormAddField") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import type { FormField, FormFieldType, FormSchema } from "@hay/form-schema";

const props = defineProps<{
  modelValue: FormSchema;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: FormSchema): void;
}>();

const fieldTypes: FormFieldType[] = [
  "text",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "checkbox",
  "textarea",
];

const uid = computed(() => props.modelValue.id || "form");

function update(partial: Partial<FormSchema>) {
  emit("update:modelValue", { ...props.modelValue, ...partial });
}

function updateField(index: number, partial: Partial<FormField>) {
  const fields = props.modelValue.fields.map((f, i) =>
    i === index ? ({ ...f, ...partial } as FormField) : f,
  );
  update({ fields });
}

function updateFieldType(index: number, value: unknown) {
  const type = (fieldTypes.includes(value as FormFieldType) ? value : "text") as FormFieldType;
  const patch: Partial<FormField> = { type };
  if (type === "select" && !props.modelValue.fields[index]?.options) {
    patch.options = [{ value: "option_1", label: "Option" }];
  }
  updateField(index, patch);
}

function updateMapToCustomer(index: number, value: unknown) {
  if (typeof value !== "string" || value === "none") {
    updateField(index, { mapToCustomer: undefined });
    return;
  }
  if (value === "name" || value === "email" || value === "phone") {
    updateField(index, { mapToCustomer: value });
  }
}

function addField() {
  const fields = [
    ...props.modelValue.fields,
    {
      name: `field_${props.modelValue.fields.length + 1}`,
      label: "New field",
      type: "text" as FormFieldType,
    },
  ];
  update({ fields });
}

function removeField(index: number) {
  const fields = props.modelValue.fields.filter((_, i) => i !== index);
  update({ fields });
}

function moveField(index: number, delta: number) {
  const next = index + delta;
  if (next < 0 || next >= props.modelValue.fields.length) return;
  const fields = [...props.modelValue.fields];
  const tmp = fields[index] as FormField;
  fields[index] = fields[next] as FormField;
  fields[next] = tmp;
  update({ fields });
}

function addOption(index: number) {
  const field = props.modelValue.fields[index];
  if (!field) return;
  const options = [
    ...(field.options ?? []),
    { value: `option_${(field.options?.length ?? 0) + 1}`, label: "Option" },
  ];
  updateField(index, { options });
}

function removeOption(fieldIndex: number, optIndex: number) {
  const field = props.modelValue.fields[fieldIndex];
  if (!field?.options) return;
  const options = field.options.filter((_, i) => i !== optIndex);
  updateField(fieldIndex, { options });
}

function updateOption(
  fieldIndex: number,
  optIndex: number,
  partial: { value?: string; label?: string },
) {
  const field = props.modelValue.fields[fieldIndex];
  if (!field?.options) return;
  const options = field.options.map((o, i) => (i === optIndex ? { ...o, ...partial } : o));
  updateField(fieldIndex, { options });
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function maybeAutoSlug(field: FormField, label: string): string {
  // Only auto-derive if the existing key looks like the previous slug of the label
  const expected = slugify(label);
  if (!expected) return field.name;
  if (!field.name) return expected;
  const looksAuto = field.name === slugify(field.label);
  return looksAuto ? expected : field.name;
}
</script>
