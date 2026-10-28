<template>
  <!-- Shown while the conversation waits for a person (D5-10), with email capture (D5-8). -->
  <div class="hay-waiting" role="status">
    <div class="hay-waiting__title">
      <span class="hay-waiting__dot" aria-hidden="true"></span>
      {{ t("waiting.title") }}
    </div>
    <p v-if="detail" class="hay-waiting__detail">{{ detail }}</p>

    <p v-if="contactSaved" class="hay-waiting__detail">{{ t("contact.saved") }}</p>
    <form v-else class="hay-waiting__form" novalidate @submit.prevent="submit">
      <p class="hay-waiting__detail">{{ t("contact.prompt") }}</p>
      <div class="hay-waiting__row">
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          class="hay-waiting__input"
          :aria-label="t('contact.label')"
          :placeholder="t('contact.placeholder')"
          :disabled="saving"
        />
        <button type="submit" class="hay-waiting__button" :disabled="saving || !email.trim()">
          {{ t("contact.submit") }}
        </button>
      </div>
      <p v-if="failed" class="hay-waiting__error" role="alert">{{ t("contact.failed") }}</p>
      <p class="hay-waiting__consent">{{ t("contact.consent") }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  detail: string | null;
  contactSaved: boolean;
  saveEmail: (email: string) => Promise<boolean>;
}>();

const t = useI18n();
const email = ref("");
const saving = ref(false);
const failed = ref(false);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  margin: 0 12px 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-neutral-200);
  border-radius: 10px;
  background: var(--color-neutral-50);
  font-size: 13px;
  color: var(--color-neutral-700);
}

.hay-waiting__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--color-neutral-900);
}

.hay-waiting__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hay-primary);
  animation: hay-waiting-pulse 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .hay-waiting__dot {
    animation: none;
  }
}

@keyframes hay-waiting-pulse {
  50% {
    opacity: 0.35;
  }
}

.hay-waiting__detail {
  margin: 4px 0 0;
  line-height: 1.4;
}

.hay-waiting__form {
  margin-top: 6px;
}

.hay-waiting__row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.hay-waiting__input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--color-neutral-200);
  border-radius: 8px;
  font: inherit;
  background: white;
}

.hay-waiting__input:focus-visible,
.hay-waiting__button:focus-visible {
  outline: 2px solid var(--hay-primary);
  outline-offset: 1px;
}

.hay-waiting__button {
  padding: 7px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--hay-primary);
  color: white;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.hay-waiting__button:disabled {
  opacity: 0.5;
  cursor: default;
}

.hay-waiting__error {
  margin: 4px 0 0;
  color: #b42318;
}

.hay-waiting__consent {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--color-neutral-500);
}
</style>
