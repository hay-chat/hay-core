<template>
  <a :href="url" target="_blank" rel="noopener noreferrer" class="hay-powered-by">
    {{ t("chat.poweredBy") }}
    <b>Hay</b>
  </a>
</template>

<script setup lang="ts">
import { useI18n } from "@/i18n";

const t = useI18n();

const url = (() => {
  const link = new URL("https://hay.chat");
  link.searchParams.set("utm_source", window.location.hostname);
  link.searchParams.set("utm_medium", "webchat");
  link.searchParams.set("utm_campaign", "powered_by");
  return link.toString();
})();
</script>

<style>
.hay-powered-by {
  align-self: center;
  font-size: 11.5px;
  line-height: 1;
  color: var(--hay-meta);
  text-decoration: none;
}

.hay-powered-by:hover {
  color: var(--hay-text);
}

.hay-powered-by b {
  font-weight: 600;
}
</style>
