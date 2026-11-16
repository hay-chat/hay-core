<template>
  <div class="space-y-5">
    <HelpCenterThemePresets
      :model-value="modelValue"
      :site-name="siteName"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <HelpCenterColorField
      id="hc-accent-hex"
      test-id="accent"
      :model-value="modelValue.accentColor"
      :label="$t('helpCenter.theme.accentColor')"
      :picker-label="$t('helpCenter.theme.accentColorPicker')"
      @update:model-value="update({ accentColor: $event })"
    >
      <p v-if="lowContrast" class="text-amber-700" data-testid="accent-contrast-warning">
        {{ $t("helpCenter.theme.contrastWarning", { ratio: whiteContrast.toFixed(1) }) }}
      </p>
    </HelpCenterColorField>

    <fieldset class="space-y-1.5">
      <legend class="text-sm font-medium">{{ $t("helpCenter.theme.font") }}</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      <p class="text-xs text-neutral-muted">{{ $t("helpCenter.theme.fontSource") }}</p>
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
      <fieldset v-for="group in styleGroups" :key="group.field" class="space-y-1.5">
        <legend class="text-sm font-medium">{{ $t(`helpCenter.theme.${group.field}`) }}</legend>
        <div class="grid grid-cols-3 gap-2">
          <label v-for="option in group.options" :key="option" class="hc-choice">
            <input
              type="radio"
              :name="`hc-${group.field}`"
              class="sr-only"
              :value="option"
              :checked="modelValue[group.field] === option"
              @change="update({ [group.field]: option })"
            />
            <span class="text-sm">{{
              $t(`helpCenter.theme.${group.field}Options.${option}`)
            }}</span>
          </label>
        </div>
      </fieldset>

      <div class="space-y-4 border-t pt-5">
        <h3 class="text-sm font-semibold">{{ $t("helpCenter.theme.hero") }}</h3>

        <fieldset class="space-y-1.5">
          <legend class="text-sm font-medium">{{ $t("helpCenter.theme.heroStyle") }}</legend>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <label
              v-for="style in HELP_CENTER_HERO_STYLES"
              :key="style"
              class="hc-choice"
              :data-testid="`hero-style-${style}`"
            >
              <input
                type="radio"
                name="hc-hero-style"
                class="sr-only"
                :value="style"
                :checked="modelValue.heroStyle === style"
                @change="update({ heroStyle: style })"
              />
              <span
                class="block h-5 w-full rounded-sm border border-neutral-200"
                :style="{ background: heroSwatches[style] }"
                aria-hidden="true"
              />
              <span class="text-sm">{{ $t(`helpCenter.theme.heroStyleOptions.${style}`) }}</span>
            </label>
          </div>
        </fieldset>

        <template v-if="modelValue.heroStyle === 'gradient'">
          <div class="grid gap-4 sm:grid-cols-2">
            <HelpCenterColorField
              id="hc-gradient-from"
              test-id="gradient-from"
              :model-value="modelValue.heroGradientFrom"
              :label="$t('helpCenter.theme.heroGradientFrom')"
              :picker-label="$t('helpCenter.theme.heroGradientFromPicker')"
              @update:model-value="update({ heroGradientFrom: $event })"
            />
            <HelpCenterColorField
              id="hc-gradient-to"
              test-id="gradient-to"
              :model-value="modelValue.heroGradientTo"
              :label="$t('helpCenter.theme.heroGradientTo')"
              :picker-label="$t('helpCenter.theme.heroGradientToPicker')"
              @update:model-value="update({ heroGradientTo: $event })"
            />
          </div>
          <p
            v-if="gradientText.contrast < MIN_TEXT_CONTRAST"
            class="text-sm text-amber-700"
            role="note"
            data-testid="gradient-contrast-warning"
          >
            {{
              $t("helpCenter.theme.gradientContrastWarning", {
                ratio: gradientText.contrast.toFixed(1),
              })
            }}
          </p>
          <fieldset class="space-y-1.5">
            <legend class="text-sm font-medium">
              {{ $t("helpCenter.theme.heroGradientDirection") }}
            </legend>
            <div class="grid grid-cols-3 gap-2">
              <label
                v-for="direction in HELP_CENTER_GRADIENT_DIRECTIONS"
                :key="direction"
                class="hc-choice"
              >
                <input
                  type="radio"
                  name="hc-gradient-direction"
                  class="sr-only"
                  :value="direction"
                  :checked="modelValue.heroGradientDirection === direction"
                  @change="update({ heroGradientDirection: direction })"
                />
                <span
                  class="block h-5 w-full rounded-sm"
                  :style="{
                    background: `linear-gradient(${HELP_CENTER_GRADIENT_ANGLES[direction]}, ${modelValue.heroGradientFrom}, ${modelValue.heroGradientTo})`,
                  }"
                  aria-hidden="true"
                />
                <span class="text-sm">
                  {{ $t(`helpCenter.theme.heroGradientDirectionOptions.${direction}`) }}
                </span>
              </label>
            </div>
          </fieldset>
        </template>

        <template v-if="modelValue.heroStyle === 'image'">
          <slot name="hero-image" />
          <fieldset class="space-y-1.5">
            <legend class="text-sm font-medium">{{ $t("helpCenter.theme.heroOverlay") }}</legend>
            <div class="grid grid-cols-3 gap-2">
              <label v-for="overlay in HELP_CENTER_HERO_OVERLAYS" :key="overlay" class="hc-choice">
                <input
                  type="radio"
                  name="hc-hero-overlay"
                  class="sr-only"
                  :value="overlay"
                  :checked="modelValue.heroOverlay === overlay"
                  @change="update({ heroOverlay: overlay })"
                />
                <span class="text-sm">
                  {{ $t(`helpCenter.theme.heroOverlayOptions.${overlay}`) }}
                </span>
              </label>
            </div>
            <p class="text-xs text-neutral-muted">{{ $t("helpCenter.theme.heroOverlayHint") }}</p>
          </fieldset>
        </template>

        <fieldset class="space-y-1.5">
          <legend class="text-sm font-medium">{{ $t("helpCenter.theme.heroAlign") }}</legend>
          <div class="grid grid-cols-2 gap-2">
            <label v-for="align in HELP_CENTER_HERO_ALIGNS" :key="align" class="hc-choice">
              <input
                type="radio"
                name="hc-hero-align"
                class="sr-only"
                :value="align"
                :checked="modelValue.heroAlign === align"
                @change="update({ heroAlign: align })"
              />
              <component :is="align === 'left' ? AlignLeft : AlignCenter" class="h-4 w-4" />
              <span class="text-sm">{{ $t(`helpCenter.theme.heroAlignOptions.${align}`) }}</span>
            </label>
          </div>
        </fieldset>

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
      </div>

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
import { computed } from "vue";
import { AlignCenter, AlignLeft, LayoutGrid, List } from "lucide-vue-next";
import {
  HELP_CENTER_COLOR_SCHEMES,
  HELP_CENTER_CORNERS,
  HELP_CENTER_FONTS,
  HELP_CENTER_FONT_STACKS,
  HELP_CENTER_FONTS_STYLESHEET,
  HELP_CENTER_GRADIENT_ANGLES,
  HELP_CENTER_GRADIENT_DIRECTIONS,
  HELP_CENTER_HERO_ALIGNS,
  HELP_CENTER_HERO_OVERLAYS,
  HELP_CENTER_HERO_STYLES,
  HELP_CENTER_LAYOUTS,
  MIN_TEXT_CONTRAST,
  contrastRatio,
  readableTextOn,
  type HelpCenterTheme,
} from "@/utils/help-center";
import HelpCenterColorField from "./HelpCenterColorField.vue";
import HelpCenterThemePresets from "./HelpCenterThemePresets.vue";

// The site's typefaces, so the font options and theme thumbnails show the real thing.
useHead({ link: [{ rel: "stylesheet", href: HELP_CENTER_FONTS_STYLESHEET, key: "hc-fonts" }] });

const props = defineProps<{
  modelValue: HelpCenterTheme;
  /** Also show colour scheme, corners, the hero and "Powered by Hay". */
  extended?: boolean;
  /** Shown in the preset thumbnails. */
  siteName?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: HelpCenterTheme] }>();

function update(patch: Partial<HelpCenterTheme>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}

/** Settings shown as a plain row of text choices. */
const styleGroups = [
  { field: "colorScheme", options: HELP_CENTER_COLOR_SCHEMES },
  { field: "corners", options: HELP_CENTER_CORNERS },
] as const;

const heroSwatches = computed<Record<HelpCenterTheme["heroStyle"], string>>(() => ({
  solid: props.modelValue.accentColor,
  gradient: `linear-gradient(90deg, ${props.modelValue.heroGradientFrom}, ${props.modelValue.heroGradientTo})`,
  tint: `color-mix(in srgb, ${props.modelValue.accentColor} 14%, #ffffff)`,
  image: "linear-gradient(135deg, #4b5563, #111827)",
  plain: "#ffffff",
}));

// On the accent colour the site picks black or white text, and one of the two always
// passes. What a light accent loses is its use as a link colour on the white page:
// below 4.5:1 the site shows links in the normal text colour instead.
const whiteContrast = computed(() => contrastRatio(props.modelValue.accentColor, "#ffffff"));
const lowContrast = computed(() => whiteContrast.value < MIN_TEXT_CONTRAST);

// On a gradient the hero text has to read on both ends, and neither black nor white may.
const gradientText = computed(() =>
  readableTextOn(props.modelValue.heroGradientFrom, props.modelValue.heroGradientTo),
);
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
