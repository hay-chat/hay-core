<template>
  <section class="space-y-4 pb-6" data-testid="webchat-appearance">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.appearance.brand") }}</h2>
      <p class="text-sm text-neutral-500">
        {{
          websiteHostName
            ? $t("webchat.appearance.takenFrom", { host: websiteHostName })
            : $t("webchat.appearance.noWebsite")
        }}
        <NuxtLink to="/settings/general" class="text-primary hover:underline">
          {{
            websiteHostName
              ? $t("webchat.appearance.changeWebsite")
              : $t("webchat.appearance.addWebsite")
          }}
        </NuxtLink>
      </p>
    </div>

    <div class="space-y-2">
      <Label for="webchat-logo">{{ $t("webchat.appearance.logo") }}</Label>
      <div class="flex flex-wrap items-center gap-3">
        <img
          v-if="state.logoUrl.value"
          :src="state.logoSrc.value ?? ''"
          :alt="$t('webchat.appearance.logoAlt')"
          class="h-10 w-10 rounded-lg border object-contain"
        />
        <span
          v-else
          class="grid h-10 w-10 place-items-center rounded-lg font-bold"
          :style="{ background: form.brandColor, color: initialColor }"
          aria-hidden="true"
        >
          {{ initial }}
        </span>
        <input
          id="webchat-logo"
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="sr-only"
          @change="onLogoPicked"
        />
        <Button
          variant="outline"
          size="sm"
          :loading="state.logoBusy.value"
          @click="fileInput?.click()"
        >
          {{
            state.logoUrl.value ? $t("webchat.appearance.replace") : $t("webchat.appearance.upload")
          }}
        </Button>
        <Button
          v-if="state.logoSource.value === 'custom'"
          variant="link"
          size="sm"
          :disabled="state.logoBusy.value"
          @click="state.removeLogo"
        >
          {{ $t("webchat.appearance.remove") }}
        </Button>
        <span class="text-sm text-neutral-500">{{ logoCaption }}</span>
      </div>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.logoHint") }}</p>
    </div>

    <div class="space-y-2">
      <Label for="webchat-brand-hex">{{ $t("webchat.appearance.brandColor") }}</Label>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="state.brandPalette.value.length">
          <button
            v-for="color in state.brandPalette.value"
            :key="color"
            type="button"
            :aria-label="$t('webchat.appearance.useColor', { color })"
            :aria-pressed="form.brandColor === color"
            class="h-8 w-8 rounded-full ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="form.brandColor === color ? 'ring-2 ring-primary' : 'ring-1 ring-neutral-300'"
            :style="{ background: color }"
            @click="setColor(color)"
          />
          <span class="mx-1 h-6 w-px bg-neutral-200" aria-hidden="true" />
        </template>
        <div class="flex h-10 items-center gap-2 rounded-md border bg-white pl-1.5 pr-3">
          <input
            type="color"
            :value="form.brandColor"
            :aria-label="$t('webchat.appearance.pickColor')"
            class="h-7 w-7 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0"
            @input="setColor(($event.target as HTMLInputElement).value)"
          />
          <input
            id="webchat-brand-hex"
            v-model="hexText"
            spellcheck="false"
            autocomplete="off"
            maxlength="7"
            class="w-20 bg-transparent font-mono text-sm uppercase text-neutral-700 outline-none"
            @input="onHexInput"
            @blur="hexText = form.brandColor"
          />
        </div>
      </div>
      <p class="text-sm text-neutral-500">
        {{
          state.brandPalette.value.length
            ? $t("webchat.appearance.brandColorHintPalette")
            : $t("webchat.appearance.brandColorHint")
        }}
      </p>
    </div>
  </section>

  <section class="space-y-4 py-6">
    <h2 class="text-base">{{ $t("webchat.appearance.look") }}</h2>
    <WebchatChoiceChips
      v-model="form.themeMode"
      name="webchat-theme"
      :legend="$t('webchat.appearance.theme')"
      :options="[
        { value: 'light', label: $t('webchat.appearance.themeLight') },
        { value: 'dark', label: $t('webchat.appearance.themeDark') },
        { value: 'system', label: $t('webchat.appearance.themeSystem') },
      ]"
    />
    <WebchatChoiceChips
      v-model="form.position"
      name="webchat-position"
      :legend="$t('webchat.appearance.position')"
      :options="[
        { value: 'right', label: $t('webchat.appearance.positionRight') },
        { value: 'left', label: $t('webchat.appearance.positionLeft') },
      ]"
    />
  </section>

  <section class="space-y-4 py-6" data-testid="webchat-button">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.appearance.button") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.buttonHint") }}</p>
    </div>
    <WebchatTilePicker
      v-model="form.launcherIcon"
      name="webchat-button-icon"
      :legend="$t('webchat.appearance.buttonIcon')"
      :options="buttonIconOptions"
    >
      <template #tile="{ value }">
        <span
          class="grid h-11 w-11 place-items-center rounded-full shadow-sm"
          :style="{ background: form.brandColor, color: initialColor }"
          aria-hidden="true"
        >
          <img
            v-if="value === 'custom'"
            :src="state.launcherIconSrc.value ?? ''"
            alt=""
            class="h-5 w-5 object-contain"
            :class="initialColor === '#ffffff' ? 'brightness-0 invert' : 'brightness-0'"
          />
          <WebchatIcon v-else :name="value" :variant="form.launcherIconStyle" class="h-5 w-5" />
        </span>
      </template>
    </WebchatTilePicker>
    <WebchatChoiceChips
      v-if="iconHasStyles"
      v-model="form.launcherIconStyle"
      name="webchat-button-icon-style"
      :legend="$t('webchat.appearance.buttonIconStyle')"
      :options="[
        { value: 'outline', label: $t('webchat.appearance.buttonStyles.outline') },
        { value: 'filled', label: $t('webchat.appearance.buttonStyles.filled') },
      ]"
    />
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="webchat-button-icon-file"
          ref="buttonIconInput"
          type="file"
          accept="image/svg+xml,.svg"
          class="sr-only"
          @change="onButtonIconPicked"
        />
        <Button
          variant="outline"
          size="sm"
          :loading="state.launcherIconBusy.value"
          @click="buttonIconInput?.click()"
        >
          {{
            state.launcherIconSrc.value
              ? $t("webchat.appearance.replaceSvg")
              : $t("webchat.appearance.uploadSvg")
          }}
        </Button>
        <Button
          v-if="state.launcherIconSrc.value"
          variant="link"
          size="sm"
          :disabled="state.launcherIconBusy.value"
          @click="state.removeLauncherIcon"
        >
          {{ $t("webchat.appearance.remove") }}
        </Button>
      </div>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.buttonIconHint") }}</p>
    </div>
  </section>

  <section class="space-y-4 py-6" data-testid="webchat-assistant">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.appearance.assistant") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.assistantHint") }}</p>
    </div>
    <Input
      v-model="form.assistantName"
      :label="$t('webchat.appearance.assistantName')"
      :placeholder="$t('webchat.appearance.assistantFallback')"
      maxlength="255"
      class="max-w-sm"
      data-testid="webchat-assistant-name"
    />
    <WebchatTilePicker
      :model-value="avatarChoice"
      name="webchat-assistant-avatar"
      :legend="$t('webchat.appearance.avatar')"
      :options="avatarOptions"
      @update:model-value="pickAvatar"
    >
      <template #tile="{ value }">
        <img
          v-if="value === 'upload'"
          :src="state.assistantAvatarSrc.value ?? ''"
          alt=""
          class="h-11 w-11 rounded-full object-cover"
        />
        <span
          v-else
          class="grid h-11 w-11 place-items-center rounded-full"
          :style="avatarTint"
          aria-hidden="true"
        >
          <WebchatIcon :name="value" class="h-6 w-6" />
        </span>
      </template>
    </WebchatTilePicker>
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="webchat-assistant-avatar-file"
          ref="avatarInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="sr-only"
          @change="onAvatarPicked"
        />
        <Button
          variant="outline"
          size="sm"
          :loading="state.avatarBusy.value"
          @click="avatarInput?.click()"
        >
          {{
            state.assistantAvatarSrc.value
              ? $t("webchat.appearance.replacePicture")
              : $t("webchat.appearance.uploadPicture")
          }}
        </Button>
      </div>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.avatarHint") }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Hay } from "@/utils/api";
import { useWebchatSettings, type AssistantAvatarPreset } from "@/composables/useWebchatSettings";
import { useUserStore } from "@/stores/user";
import {
  LAUNCHER_PRESET_ICONS,
  SINGLE_STYLE_LAUNCHER_ICONS,
  normalizeHex,
  websiteHost,
  type LauncherIcon,
} from "@/utils/webchat-settings";

const { t } = useI18n();
const state = useWebchatSettings();
const form = state.form;
const userStore = useUserStore();

const fileInput = ref<HTMLInputElement | null>(null);
const buttonIconInput = ref<HTMLInputElement | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);
const websiteHostName = ref<string | null>(null);

const organizationName = computed(
  () =>
    userStore.organizations.find((org) => org.id === userStore.activeOrganizationId)?.name ?? "",
);
const initial = computed(() => organizationName.value.trim().charAt(0).toUpperCase() || "H");
// The widget computes readable text properly; this placeholder only needs to be legible.
const initialColor = computed(() => {
  const hex = form.value.brandColor.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#ffffff";
});

const logoCaption = computed(() => {
  if (state.logoSource.value === "custom") return t("webchat.appearance.logoCustom");
  if (state.logoSource.value === "website") return t("webchat.appearance.logoWebsite");
  return t("webchat.appearance.logoNone");
});

const hexText = ref(form.value.brandColor.toUpperCase());
watch(
  () => form.value.brandColor,
  (color) => {
    if (normalizeHex(hexText.value) !== color) hexText.value = color.toUpperCase();
  },
);

function setColor(value: string) {
  const color = normalizeHex(value);
  if (color) form.value.brandColor = color;
}

function onHexInput() {
  const color = normalizeHex(hexText.value);
  if (color && hexText.value.replace("#", "").length === 6) form.value.brandColor = color;
}

/** Hands the picked file to `upload` and clears the input, so the same file can be picked again. */
function onFilePicked(upload: (file: File) => Promise<void>) {
  return (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void upload(file);
    input.value = "";
  };
}
const onLogoPicked = onFilePicked(state.uploadLogo);
const onButtonIconPicked = onFilePicked(state.uploadLauncherIcon);
const onAvatarPicked = onFilePicked(state.uploadAssistantAvatar);

// --- Chat button: the uploaded icon is a choice only once there is one.
const buttonIconOptions = computed(() => [
  ...LAUNCHER_PRESET_ICONS.map((value) => ({
    value: value as LauncherIcon,
    label: t(`webchat.appearance.buttonIcons.${value}`),
  })),
  ...(state.launcherIconSrc.value
    ? [{ value: "custom" as LauncherIcon, label: t("webchat.appearance.buttonIcons.custom") }]
    : []),
]);
// Outline/filled applies only to presets drawn both ways.
const iconHasStyles = computed(
  () =>
    form.value.launcherIcon !== "custom" &&
    !SINGLE_STYLE_LAUNCHER_ICONS.includes(form.value.launcherIcon),
);

// --- Assistant avatar: an uploaded picture wins over the preset icon. Picking an icon
// while there is a picture removes the picture, so the icon shows.
type AvatarChoice = AssistantAvatarPreset | "upload";
const avatarChoice = computed<AvatarChoice>(() =>
  state.assistantAvatarSrc.value ? "upload" : form.value.assistantAvatarPreset,
);
const avatarOptions = computed(() => [
  { value: "sparkle" as AvatarChoice, label: t("webchat.appearance.avatarPresets.sparkle") },
  { value: "sparkles" as AvatarChoice, label: t("webchat.appearance.avatarPresets.sparkles") },
  { value: "robot" as AvatarChoice, label: t("webchat.appearance.avatarPresets.robot") },
  ...(state.assistantAvatarSrc.value
    ? [{ value: "upload" as AvatarChoice, label: t("webchat.appearance.avatarPicture") }]
    : []),
]);
function pickAvatar(choice: AvatarChoice) {
  if (choice === "upload") return;
  form.value.assistantAvatarPreset = choice;
  if (state.assistantAvatarSrc.value) void state.removeAssistantAvatar();
}
// The widget draws the assistant's icon in the brand colour on a light tint of it.
const avatarTint = computed(() => ({
  background: `color-mix(in srgb, ${form.value.brandColor} 12%, white)`,
  color: form.value.brandColor,
}));

onMounted(async () => {
  try {
    websiteHostName.value = websiteHost((await Hay.organizations.getSettings.query()).website);
  } catch {
    // The hint falls back to "add your website".
  }
});
</script>
