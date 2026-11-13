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

  <section class="flex items-center gap-3 py-6">
    <img
      v-if="assistant?.avatarUrl"
      :src="assistant.avatarUrl"
      alt=""
      class="h-9 w-9 rounded-full object-cover"
    />
    <span
      v-else
      class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef0ff] text-[#3b3f9e]"
      aria-hidden="true"
    >
      <Sparkles class="h-4 w-4" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-neutral-900">
        {{ assistant?.name || $t("webchat.appearance.assistantFallback") }}
      </p>
      <p class="text-sm text-neutral-500">{{ $t("webchat.appearance.assistantHint") }}</p>
    </div>
    <Button variant="link" size="sm" @click="router.push('/settings/assistant')">
      {{ $t("webchat.appearance.edit") }}
    </Button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Sparkles } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useWebchatSettings } from "@/composables/useWebchatSettings";
import { useUserStore } from "@/stores/user";
import { normalizeHex, websiteHost } from "@/utils/webchat-settings";

const { t } = useI18n();
const router = useRouter();
const state = useWebchatSettings();
const form = state.form;
const userStore = useUserStore();

const fileInput = ref<HTMLInputElement | null>(null);
const websiteHostName = ref<string | null>(null);
const assistant = ref<{ name: string | null; avatarUrl: string | null } | null>(null);

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

function onLogoPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void state.uploadLogo(file);
  input.value = "";
}

onMounted(async () => {
  const [settings, identity] = await Promise.allSettled([
    Hay.organizations.getSettings.query(),
    Hay.organizations.assistant.get.query(),
  ]);
  if (settings.status === "fulfilled") websiteHostName.value = websiteHost(settings.value.website);
  if (identity.status === "fulfilled") {
    assistant.value = { name: identity.value.name, avatarUrl: identity.value.avatarUrl };
  }
});
</script>
