<template>
  <fieldset class="space-y-1.5">
    <legend class="text-sm font-medium">{{ $t("helpCenter.theme.presets") }}</legend>
    <p class="text-xs text-neutral-muted" data-testid="preset-status" aria-live="polite">
      {{
        !current && lastPicked
          ? $t("helpCenter.theme.presetCustomised", {
              name: $t(`helpCenter.theme.presetNames.${lastPicked}`),
            })
          : $t("helpCenter.theme.presetsHint")
      }}
    </p>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <label
        v-for="preset in previews"
        :key="preset.id"
        class="hc-preset"
        :data-testid="`preset-${preset.id}`"
      >
        <input
          type="radio"
          name="hc-preset"
          class="sr-only"
          :value="preset.id"
          :checked="current?.id === preset.id"
          @change="pick(preset.id)"
        />
        <span class="hc-thumb" aria-hidden="true" :style="preset.look.page">
          <span class="hc-thumb-hero" :style="preset.look.hero">
            <span class="hc-thumb-title">{{
              siteName || $t("helpCenter.theme.presetSample")
            }}</span>
            <span class="hc-thumb-search" :style="preset.look.control" />
          </span>
          <span v-if="preset.look.cards" class="hc-thumb-cards">
            <span v-for="n in 3" :key="n" :style="preset.look.card" />
          </span>
          <span v-else class="hc-thumb-list">
            <span v-for="n in 3" :key="n" :style="preset.look.line" />
          </span>
        </span>
        <span class="text-sm font-medium">{{
          $t(`helpCenter.theme.presetNames.${preset.id}`)
        }}</span>
      </label>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  HELP_CENTER_FONT_STACKS,
  HELP_CENTER_GRADIENT_ANGLES,
  HELP_CENTER_PRESETS,
  applyPreset,
  matchingPreset,
  readableTextOn,
  type HelpCenterPreset,
  type HelpCenterTheme,
} from "@/utils/help-center";

const props = defineProps<{
  modelValue: HelpCenterTheme;
  /** Shown in the thumbnails' hero. */
  siteName?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: HelpCenterTheme] }>();

/** The site's page colours (styles.ts), enough for a thumbnail. */
const PALETTES = {
  light: { background: "#ffffff", surface: "#f5f6f8", text: "#1a1d21", border: "#dde1e6" },
  dark: { background: "#111418", surface: "#1a1f25", text: "#e8ebee", border: "#2e353d" },
};
/** Card and control corners, scaled down to thumbnail size. */
const RADII: Record<HelpCenterTheme["corners"], { card: string; control: string }> = {
  sharp: { card: "0", control: "0" },
  rounded: { card: "3px", control: "2px" },
  pill: { card: "6px", control: "999px" },
};

/** A thumbnail of the home page with the theme, drawn with the customer's own accent. */
function look(theme: HelpCenterTheme) {
  const palette = PALETTES[theme.colorScheme === "dark" ? "dark" : "light"];
  const accent = theme.accentColor;
  const hero = {
    solid: { background: accent, color: readableTextOn(accent).color },
    gradient: {
      background: `linear-gradient(${HELP_CENTER_GRADIENT_ANGLES[theme.heroGradientDirection]}, ${theme.heroGradientFrom}, ${theme.heroGradientTo})`,
      color: readableTextOn(theme.heroGradientFrom, theme.heroGradientTo).color,
    },
    tint: {
      background: `color-mix(in srgb, ${accent} 14%, ${palette.background})`,
      color: palette.text,
    },
    image: { background: "linear-gradient(135deg, #4b5563, #111827)", color: "#ffffff" },
    plain: { background: palette.background, color: palette.text },
  }[theme.heroStyle];
  const radius = RADII[theme.corners];
  return {
    page: {
      background: palette.background,
      color: palette.text,
      fontFamily: HELP_CENTER_FONT_STACKS[theme.font],
    },
    hero: {
      ...hero,
      alignItems: theme.heroAlign === "left" ? "flex-start" : "center",
      borderBottom: theme.heroStyle === "plain" ? `1px solid ${palette.border}` : "none",
    },
    control: {
      borderRadius: radius.control,
      background: palette.background,
      borderColor: palette.border,
    },
    card: { borderRadius: radius.card, background: palette.surface, borderColor: palette.border },
    line: { borderColor: palette.border, background: palette.text },
    cards: theme.layout === "cards",
  };
}

const previews = computed(() =>
  HELP_CENTER_PRESETS.map((preset) => ({
    id: preset.id,
    look: look(applyPreset(props.modelValue, preset)),
  })),
);

const current = computed(() => matchingPreset(props.modelValue));

// Only for the "customised from" note; the saved theme does not record a preset.
const lastPicked = ref<HelpCenterPreset["id"] | null>(current.value?.id ?? null);

function pick(id: HelpCenterPreset["id"]) {
  const preset = HELP_CENTER_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  lastPicked.value = id;
  emit("update:modelValue", applyPreset(props.modelValue, preset));
}
</script>

<style scoped lang="postcss">
.hc-preset {
  @apply flex cursor-pointer flex-col gap-1.5 rounded-lg border border-input bg-background p-2 transition-colors;
}
.hc-preset:hover {
  @apply border-neutral-400;
}
.hc-preset:has(input:checked) {
  @apply border-primary bg-primary/5 ring-1 ring-primary;
}
.hc-preset:has(input:focus-visible) {
  @apply ring-2 ring-ring ring-offset-2;
}
.hc-thumb {
  @apply flex aspect-[4/3] w-full flex-col overflow-hidden rounded border border-neutral-200;
}
.hc-thumb-hero {
  @apply flex flex-col justify-center gap-1 px-2 py-2;
  flex: 0 0 46%;
}
.hc-thumb-title {
  @apply max-w-full truncate font-semibold;
  font-size: 9px;
  line-height: 1.1;
}
.hc-thumb-search {
  @apply block h-2 w-3/4 border;
}
.hc-thumb-cards {
  @apply grid flex-1 grid-cols-3 gap-1 p-1.5;
}
.hc-thumb-cards > span {
  @apply block border;
}
.hc-thumb-list {
  @apply flex flex-1 flex-col justify-center gap-1.5 px-2;
}
.hc-thumb-list > span {
  @apply block h-px w-full opacity-40;
}
</style>
