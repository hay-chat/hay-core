<template>
  <div class="space-y-5">
    <div class="space-y-1.5">
      <Label for="hc-accent-hex">{{ $t("helpCenter.theme.accentColor") }}</Label>
      <div class="flex items-center gap-2">
        <input
          type="color"
          class="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
          :value="modelValue.accentColor"
          :aria-label="$t('helpCenter.theme.accentColorPicker')"
          @input="onColorPicked"
        />
        <div class="w-32">
          <Input
            id="hc-accent-hex"
            v-model="hexText"
            maxlength="7"
            autocomplete="off"
            spellcheck="false"
            aria-describedby="hc-accent-notes"
          />
        </div>
      </div>
      <div id="hc-accent-notes" class="space-y-1 text-sm" aria-live="polite">
        <p v-if="!hexValid" class="text-destructive" data-testid="accent-invalid">
          {{ $t("helpCenter.theme.accentColorInvalid") }}
        </p>
        <p v-else-if="lowContrast" class="text-amber-700" data-testid="accent-contrast-warning">
          {{ $t("helpCenter.theme.contrastWarning", { ratio: whiteContrast.toFixed(1) }) }}
        </p>
      </div>
    </div>

    <fieldset class="space-y-1.5">
      <legend class="text-sm font-medium">{{ $t("helpCenter.theme.font") }}</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label v-for="font in HELP_CENTER_FONTS" :key="font" class="hc-choice">
          <input
            type="radio"
            name="hc-font"
            class="sr-only"
            :value="font"
            :checked="modelValue.font === font"
            @change="update({ font })"
          />
          <span class="text-xl leading-none" :style="{ fontFamily: HELP_CENTER_FONT_STACKS[font] }"
            >Aa</span
          >
          <span class="text-sm" :style="{ fontFamily: HELP_CENTER_FONT_STACKS[font] }">
            {{ $t(`helpCenter.theme.fonts.${font}`) }}
          </span>
        </label>
      </div>
    </fieldset>

    <fieldset class="space-y-1.5">
      <legend class="text-sm font-medium">{{ $t("helpCenter.theme.layout") }}</legend>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label v-for="layout in HELP_CENTER_LAYOUTS" :key="layout" class="hc-choice">
          <input
            type="radio"
            name="hc-layout"
            class="sr-only"
            :value="layout"
            :checked="modelValue.layout === layout"
            @change="update({ layout })"
          />
          <component :is="layout === 'cards' ? LayoutGrid : List" class="h-5 w-5" />
          <span class="text-sm font-medium">{{ $t(`helpCenter.theme.layouts.${layout}`) }}</span>
          <span class="text-xs text-neutral-muted">
            {{ $t(`helpCenter.theme.layouts.${layout}Hint`) }}
          </span>
        </label>
      </div>
    </fieldset>

    <template v-if="extended">
      <Input
        id="hc-hero-title"
        :model-value="modelValue.heroTitle ?? ''"
        :label="$t('helpCenter.theme.heroTitle')"
        :placeholder="$t('helpCenter.theme.heroTitlePlaceholder')"
        maxlength="120"
        @update:model-value="update({ heroTitle: String($event) || null })"
      />
      <Input
        id="hc-hero-subtitle"
        :model-value="modelValue.heroSubtitle ?? ''"
        :label="$t('helpCenter.theme.heroSubtitle')"
        :placeholder="$t('helpCenter.theme.heroSubtitlePlaceholder')"
        maxlength="240"
        @update:model-value="update({ heroSubtitle: String($event) || null })"
      />
      <Input
        id="hc-powered-by"
        type="switch"
        :model-value="modelValue.showPoweredBy"
        :label="$t('helpCenter.theme.showPoweredBy')"
        @update:model-value="update({ showPoweredBy: $event === true })"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LayoutGrid, List } from "lucide-vue-next";
import {
  HELP_CENTER_FONTS,
  HELP_CENTER_FONT_STACKS,
  HELP_CENTER_LAYOUTS,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  isHexColor,
  type HelpCenterTheme,
} from "@/utils/help-center";

const props = defineProps<{
  modelValue: HelpCenterTheme;
  /** Also show the hero text and "Powered by Hay" controls. */
  extended?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: HelpCenterTheme] }>();

function update(patch: Partial<HelpCenterTheme>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}

// The text field may hold a half-typed colour; the theme only ever holds a valid one.
const hexText = ref(props.modelValue.accentColor);
const hexValid = computed(() => isHexColor(hexText.value.trim()));

watch(hexText, (text) => {
  const hex = text.trim().toLowerCase();
  if (isHexColor(hex) && hex !== props.modelValue.accentColor) update({ accentColor: hex });
});
watch(
  () => props.modelValue.accentColor,
  (color) => {
    if (color !== hexText.value.trim().toLowerCase()) hexText.value = color;
  },
);

function onColorPicked(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    update({ accentColor: event.target.value.toLowerCase() });
  }
}

// On the accent colour the site picks black or white text, and one of the two always
// passes. What a light accent loses is its use as a link colour on the white page:
// below 4.5:1 the site shows links in the normal text colour instead.
const whiteContrast = computed(() => contrastRatio(props.modelValue.accentColor, "#ffffff"));
const lowContrast = computed(() => whiteContrast.value < MIN_TEXT_CONTRAST);
</script>

<style scoped lang="postcss">
.hc-choice {
  @apply flex cursor-pointer flex-col items-start gap-1 rounded-lg border border-input bg-background p-3 transition-colors;
}
.hc-choice:hover {
  @apply border-neutral-400;
}
.hc-choice:has(input:checked) {
  @apply border-primary bg-primary/5;
}
.hc-choice:has(input:focus-visible) {
  @apply ring-2 ring-ring ring-offset-2;
}
</style>
