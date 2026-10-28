<template>
  <!-- The Hay.chat security check frame. It stays out of sight while the check
       runs invisibly, and only shows when the shopper has to interact. -->
  <div class="hay-challenge" :class="{ 'hay-challenge--visible': interactive }" role="region"
    :aria-label="t('challenge.label')" :aria-hidden="!interactive">
    <p v-if="interactive" class="hay-challenge__prompt">{{ t("challenge.prompt") }}</p>
    <div :ref="bindHost" class="hay-challenge__host"></div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@/i18n";

const t = useI18n();

const props = defineProps<{
  interactive: boolean;
  setHost: (el: HTMLElement | null) => void;
}>();

const bindHost = (el: unknown) => props.setHost(el instanceof HTMLElement ? el : null);
</script>

<style>
.hay-challenge {
  height: 0;
  overflow: hidden;
}

.hay-challenge--visible {
  height: auto;
  margin: 0 12px 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-neutral-200);
  border-radius: 10px;
  background: var(--color-neutral-50);
}

.hay-challenge__prompt {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--color-neutral-700);
}

.hay-challenge__host .hay-challenge-frame {
  display: block;
  width: 100%;
  height: 72px;
  border: 0;
  background: transparent;
}
</style>
