<template>
  <div v-if="fields.length" class="space-y-3">
    <div v-for="field in fields" :key="field.name" class="space-y-0.5">
      <div class="flex items-baseline gap-1.5 text-xs flex-wrap">
        <span class="font-mono font-medium text-foreground">{{ field.name }}</span>
        <span class="text-muted-foreground">({{ field.type }})</span>
        <span v-if="field.required" class="text-[10px] font-medium text-amber-600">
          (Required)
        </span>
      </div>
      <p v-if="field.description" class="text-xs text-muted-foreground leading-relaxed">
        {{ field.description }}
      </p>
    </div>
  </div>
  <p v-else class="text-xs text-muted-foreground italic">No parameters.</p>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: any[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  format?: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

const props = defineProps<{
  schema?: JsonSchema | null;
}>();

const ENUM_PREVIEW_LIMIT = 5;

function describeType(prop: JsonSchemaProperty | undefined): string {
  if (!prop) return "any";
  const baseType = Array.isArray(prop.type) ? prop.type.join(" | ") : (prop.type ?? "any");

  if (prop.enum && prop.enum.length) {
    const sample = prop.enum.slice(0, ENUM_PREVIEW_LIMIT).map((v) => String(v));
    const overflow = prop.enum.length > ENUM_PREVIEW_LIMIT ? `, …` : "";
    return `${baseType}: ${sample.join(" | ")}${overflow}`;
  }

  if (baseType === "array") {
    const itemType = describeType(prop.items);
    return `${itemType}[]`;
  }

  if (baseType === "object" && prop.properties && Object.keys(prop.properties).length) {
    return `object{${Object.keys(prop.properties).join(", ")}}`;
  }

  return baseType;
}

const fields = computed(() => {
  const properties = props.schema?.properties ?? {};
  const required = new Set(props.schema?.required ?? []);

  const entries = Object.entries(properties).map(([name, prop]) => ({
    name,
    type: describeType(prop),
    required: required.has(name),
    description: prop?.description,
  }));

  // Required fields first, then optional — preserve original order within each group.
  return [...entries.filter((f) => f.required), ...entries.filter((f) => !f.required)];
});
</script>
