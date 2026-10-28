<template>
  <div class="messenger-setup-guide">
    <div class="tutorial-header">
      <h3>{{ t("title") }}</h3>
      <p>{{ t("intro") }}</p>
    </div>

    <div class="tutorial-steps">
      <div v-for="(step, index) in steps" :key="step" class="tutorial-step">
        <div class="step-header">
          <span class="step-number">{{ index + 1 }}</span>
          <h4>{{ t(`${step}.title`) }}</h4>
        </div>
        <!-- Static strings from this plugin's own i18n files. -->
        <p v-html="t(`${step}.body`)"></p>
        <p v-if="t(`${step}.hint`) !== `${step}.hint`" class="hint" v-html="t(`${step}.hint`)"></p>
      </div>
    </div>

    <div class="tutorial-footer">
      <div class="info-box">
        <svg
          class="info-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <div v-html="t('windowNote')"></div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { createTranslator } from "./messages";

export default defineComponent({
  name: "MessengerAfterSettings",
  props: {
    plugin: { type: Object, default: () => ({}) },
    config: { type: Object, default: () => ({}) },
    apiBaseUrl: { type: String, default: "http://localhost:3001" },
    locale: { type: String, default: "en" },
  },
  emits: ["update:config"],
  setup(props) {
    const translator = computed(() => createTranslator(props.locale));
    return {
      t: (key: string) => translator.value(key),
      steps: ["step1", "step2", "step3", "step4"],
    };
  },
});
</script>

<style scoped>
.tutorial-header {
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 1rem;
}

.tutorial-header h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
  margin: 0 0 0.5rem 0;
}

.tutorial-header p {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0;
}

.tutorial-steps {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--color-primary);
  color: white;
  border-radius: 50%;
  font-size: 0.875rem;
  font-weight: 600;
  flex-shrink: 0;
}

.step-header h4 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.tutorial-step p {
  color: var(--color-neutral-muted);
  font-size: 0.875rem;
  margin: 0 0 0.75rem 0;
  line-height: 1.5;
}

.tutorial-step a {
  color: var(--color-primary);
  text-decoration: underline;
}

.tutorial-step code {
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.8125rem;
}

.hint {
  color: #9ca3af !important;
  font-size: 0.8125rem !important;
}

.tutorial-footer {
  margin-top: 1.5rem;
}

.info-box {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 1rem;
}

.info-icon {
  width: 20px;
  height: 20px;
  color: #2563eb;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-box div {
  flex: 1;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #1e40af;
}

.info-box strong {
  font-weight: 600;
}

@media (max-width: 640px) {
  .messenger-setup-guide {
    padding: 1rem;
  }
}
</style>
