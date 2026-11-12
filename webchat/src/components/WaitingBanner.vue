<template>
  <!-- Shown while the conversation waits for a person (D5-10), with email capture (D5-8). -->
  <div class="hay-waiting" :class="{ 'hay-waiting--collapsed': collapsed }" role="status">
    <button
      v-if="collapsed"
      type="button"
      class="hay-waiting__title hay-waiting__toggle"
      aria-expanded="false"
      @click="collapsed = false"
    >
      <span class="hay-waiting__dot" aria-hidden="true"></span>
      <b>{{ t("waiting.title") }}</b>
      <span v-if="typical" class="hay-waiting__meta">&#32;· {{ typical }}</span>
      <svg
        class="hay-waiting__chevron"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
    <template v-else>
      <div class="hay-waiting__title">
        <span class="hay-waiting__dot" aria-hidden="true"></span>
        <b>{{ t("waiting.title") }}</b>
        <span v-if="typical" class="hay-waiting__meta">&#32;· {{ typical }}</span>
      </div>
      <p v-if="detail" class="hay-waiting__detail">{{ detail }}</p>

      <p v-if="contactSaved" class="hay-waiting__detail">{{ t("contact.saved") }}</p>
      <form v-else class="hay-waiting__form" novalidate @submit.prevent="submit">
        <label :for="inputId" class="hay-waiting__detail">{{ t("contact.prompt") }}</label>
        <div class="hay-waiting__row">
          <input
            :id="inputId"
            v-model="email"
            type="email"
            autocomplete="email"
            class="hay-waiting__input"
            :placeholder="t('contact.placeholder')"
            :disabled="saving"
          />
          <button
            type="submit"
            class="hay-waiting__button"
            :class="{ 'hay-waiting__button--ready': isValid }"
            :disabled="saving"
          >
            {{ t("contact.submit") }}
          </button>
        </div>
        <p v-if="failed" class="hay-waiting__error" role="alert">{{ t("contact.failed") }}</p>
        <p class="hay-waiting__consent">{{ t("contact.consent") }}</p>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  /** "usually ~5 min", beside the title. */
  typical: string | null;
  /** "We've alerted the team." / "The team is back Mon 09:00…". */
  detail: string | null;
  contactSaved: boolean;
  saveEmail: (email: string) => Promise<boolean>;
  /** How many messages the visitor has sent; another one collapses the banner. */
  visitorMessageCount: number;
}>();

const t = useI18n();
const email = ref("");
const saving = ref(false);
const failed = ref(false);
const inputId = `hay-notify-${Math.random().toString(36).slice(2, 8)}`;

// One line once the email is saved or the visitor carries on chatting; a tap opens it again.
const collapsed = ref(props.contactSaved);
watch(
  () => props.contactSaved,
  (saved) => {
    if (saved) collapsed.value = true;
  },
);
watch(
  () => props.visitorMessageCount,
  (count, before) => {
    if (count > before) collapsed.value = true;
  },
);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValid = computed(() => EMAIL.test(email.value.trim()));

async function submit() {
  const value = email.value.trim();
  failed.value = false;
  if (!EMAIL.test(value)) {
    failed.value = true;
    return;
  }
  saving.value = true;
  try {
    failed.value = !(await props.saveEmail(value));
  } finally {
    saving.value = false;
  }
}
</script>

<style>
.hay-waiting {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 0 12px 10px;
  padding: 12px;
  border: 1px solid var(--hay-line);
  border-radius: 14px;
  background: var(--hay-raised);
  font-size: 12.5px;
  color: var(--hay-meta);
}

.hay-waiting--collapsed {
  padding: 0;
}

.hay-waiting__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--hay-text);
}

.hay-waiting__title b {
  font-weight: 600;
}

.hay-waiting__toggle {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  text-align: left;
}

.hay-waiting__meta {
  color: var(--hay-meta);
}

.hay-waiting__chevron {
  margin-left: auto;
  color: var(--hay-meta);
}

.hay-waiting__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hay-accent);
  animation: hay-waiting-pulse 1.6s ease-in-out infinite;
}

@keyframes hay-waiting-pulse {
  50% {
    opacity: 0.35;
  }
}

.hay-waiting__detail {
  margin: 0;
  line-height: 1.4;
}

.hay-waiting__form {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.hay-waiting__row {
  display: flex;
  gap: 8px;
}

.hay-waiting__input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--hay-line);
  border-radius: 10px;
  background: var(--hay-surface);
  color: var(--hay-text);
  font-size: 13.5px;
}

.hay-waiting__input::placeholder {
  color: var(--hay-meta);
}

.hay-waiting__button {
  flex: none;
  padding: 0 14px;
  min-height: 36px;
  border: 1.5px solid var(--hay-accent);
  border-radius: 10px;
  background: transparent;
  color: var(--hay-accent);
  font-size: 13.5px;
  font-weight: 600;
}

/* Filled once the email looks valid; the surface colour reads on the accent in both themes. */
.hay-waiting__button--ready {
  background: var(--hay-accent);
  color: var(--hay-surface);
}

.hay-waiting__button:disabled {
  cursor: progress;
}

.hay-waiting__error {
  margin: 0;
  color: var(--hay-danger);
}

.hay-waiting__consent {
  margin: 0;
  font-size: 11px;
}

@media (max-width: 480px) {
  .hay-waiting__button,
  .hay-waiting__input {
    min-height: 44px;
  }
}
</style>
