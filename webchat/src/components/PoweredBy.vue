<template>
  <a :href="url" target="_blank" rel="noopener noreferrer" class="hay-powered-by">
    {{ t("chat.poweredBy") }}
    <span class="hay-powered-by__brand">
      <svg class="hay-powered-by__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="currentColor" />
        <!-- The Hay mark (dashboard layout/OrgSwitcher.vue), rounded to fit the chunk budget. -->
        <path
          class="hay-powered-by__mark"
          d="M17.5 17.1S9.2 17.4 6 17.4C8.6 7.9 10.3 2 10.9 13.2 13.2 5.2 14.6 3.5 14.6 13 19.1 2.8 17.9 12.1 17.5 17.1Z"
        />
      </svg>
      <b>Hay.chat</b>
    </span>
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

.hay-powered-by__brand {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
  vertical-align: middle;
}

.hay-powered-by__icon {
  width: 13px;
  height: 13px;
  flex: none;
}

/* Greyscale: the square takes the text colour, the mark is cut out in the window's. */
.hay-powered-by__mark {
  fill: var(--hay-surface);
}

.hay-powered-by b {
  font-weight: 600;
}
</style>
