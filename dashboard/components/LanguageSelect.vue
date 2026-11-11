<template>
  <div class="flex flex-col gap-2">
    <Label v-if="label" :id="labelId">{{ label }}</Label>
    <ComboboxRoot v-model="selected" ignore-filter>
      <ComboboxAnchor as-child>
        <!-- The search box lives in the popover, so the trigger is the tab stop. -->
        <ComboboxTrigger
          tabindex="0"
          :aria-labelledby="label ? `${labelId} ${valueId}` : valueId"
          class="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-start ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span :id="valueId" :class="['truncate', { 'text-muted-foreground': !selectedLabel }]">
            {{ selectedLabel || $t("languageSelect.placeholder") }}
          </span>
          <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
        </ComboboxTrigger>
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          :side-offset="4"
          class="z-50 w-[--reka-combobox-trigger-width] min-w-56 overflow-hidden rounded-md border border-input bg-background shadow-md"
        >
          <div class="flex items-center gap-2 border-b border-input px-3">
            <Search class="h-4 w-4 shrink-0 opacity-50" />
            <ComboboxInput
              v-model="searchTerm"
              :display-value="() => ''"
              :placeholder="$t('languageSelect.searchPlaceholder')"
              :aria-label="$t('languageSelect.searchPlaceholder')"
              class="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
            <ComboboxItem v-if="allowNone && !searchTerm.trim()" :value="NONE" :class="itemClass">
              <span class="truncate">{{ noneLabel }}</span>
              <ComboboxItemIndicator class="ml-auto">
                <Check class="h-4 w-4" />
              </ComboboxItemIndicator>
            </ComboboxItem>
            <ComboboxItem
              v-for="option in filteredOptions"
              :key="option.code"
              :value="option.code"
              :class="itemClass"
            >
              <span class="truncate">{{ option.name }}</span>
              <span
                v-if="option.englishName !== option.name"
                class="truncate text-xs text-muted-foreground"
              >
                {{ option.englishName }}
              </span>
              <ComboboxItemIndicator class="ml-auto">
                <Check class="h-4 w-4" />
              </ComboboxItemIndicator>
            </ComboboxItem>
            <p
              v-if="filteredOptions.length === 0"
              class="px-2 py-6 text-center text-sm text-muted-foreground"
            >
              {{ $t("common.noResults") }}
            </p>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
    <p v-if="helperText" class="text-sm text-muted-foreground">{{ helperText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { Check, ChevronDown, Search } from "lucide-vue-next";
import Label from "@/components/ui/Label.vue";
import {
  LANGUAGE_CODES,
  filterLanguageOptions,
  languageName,
  languageOptions,
} from "@/utils/languages";

const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    label?: string;
    helperText?: string;
    /** Languages to offer; all languages Hay knows by default. */
    codes?: readonly string[];
    /** Offer a "none" choice that sets the value to null. */
    allowNone?: boolean;
    noneLabel?: string;
  }>(),
  {
    label: undefined,
    helperText: undefined,
    codes: () => LANGUAGE_CODES,
    allowNone: false,
    noneLabel: "—",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

/** Listbox values cannot be null, so "none" travels as this sentinel. */
const NONE = "__none__";

const { locale } = useI18n();
const labelId = `language-select-${useId()}`;
const valueId = `${labelId}-value`;
const searchTerm = ref("");

const itemClass =
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

const options = computed(() => languageOptions(props.codes, locale.value));
const filteredOptions = computed(() => filterLanguageOptions(options.value, searchTerm.value));

const selected = computed<string>({
  get: () => props.modelValue ?? (props.allowNone ? NONE : ""),
  set: (value) => emit("update:modelValue", value === NONE ? null : value),
});

const selectedLabel = computed(() => {
  if (props.modelValue) return languageName(props.modelValue, locale.value);
  return props.allowNone ? props.noneLabel : "";
});
</script>
