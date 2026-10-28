<template>
  <div
    v-if="notice && !dismissed"
    role="status"
    class="flex flex-wrap items-center justify-center gap-3 border-b px-4 py-2 text-sm"
    :class="levelClass"
  >
    <component :is="icon" class="h-4 w-4 shrink-0" />
    <span>{{ message }}</span>
    <Button
      v-if="notice.ctaUrl"
      size="sm"
      variant="outline"
      class="bg-white/70"
      :loading="opening"
      @click="openCta"
    >
      {{ ctaLabel }}
    </Button>
    <button
      type="button"
      class="ml-1 rounded p-1 opacity-70 hover:opacity-100"
      :aria-label="$t('accessNotice.dismiss')"
      @click="dismiss"
    >
      <X class="h-4 w-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Info, AlertTriangle, AlertOctagon, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useUserStore } from "@/stores/user";
import { useExternalLink } from "@/composables/useExternalLink";

const { t, te } = useI18n();
const userStore = useUserStore();
const { open } = useExternalLink();

const notice = computed(() => userStore.activeAccessNotice);

const message = computed(() => {
  if (!notice.value) return "";
  const key = `accessNotice.${notice.value.key}`;
  return te(key) ? t(key, notice.value.params ?? {}) : (notice.value.text ?? "");
});

// Known notice keys get a translated label; otherwise the operator's label, then a generic one.
const ctaLabel = computed(() => {
  if (!notice.value) return "";
  const key = `accessNoticeCta.${notice.value.key}`;
  if (te(key)) return t(key);
  return notice.value.ctaLabel || t("accessNotice.defaultCta");
});

const levelClass = computed(() => {
  switch (notice.value?.level) {
    case "critical":
      return "bg-red-50 border-red-200 text-red-900";
    case "warning":
      return "bg-amber-50 border-amber-200 text-amber-900";
    default:
      return "bg-blue-50 border-blue-200 text-blue-900";
  }
});

const icon = computed(() => {
  switch (notice.value?.level) {
    case "critical":
      return AlertOctagon;
    case "warning":
      return AlertTriangle;
    default:
      return Info;
  }
});

// Dismissal is per tab and per notice version, so a changed notice shows again.
const dismissKey = computed(() =>
  notice.value
    ? `access-notice-dismissed:${userStore.activeOrganizationId}:${notice.value.key}:${notice.value.expiresAt ?? ""}`
    : "",
);
const dismissed = ref(readDismissed());

function readDismissed(): boolean {
  try {
    return !!dismissKey.value && sessionStorage.getItem(dismissKey.value) === "1";
  } catch {
    return false;
  }
}

const dismiss = () => {
  dismissed.value = true;
  try {
    sessionStorage.setItem(dismissKey.value, "1");
  } catch {
    // Private mode or blocked storage: the banner simply returns on reload.
  }
};

const opening = ref(false);
const openCta = async () => {
  if (!notice.value?.ctaUrl) return;
  opening.value = true;
  try {
    await open(notice.value.ctaUrl);
  } finally {
    opening.value = false;
  }
};
</script>
