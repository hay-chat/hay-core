<template>
  <a :href="url" target="_blank" rel="noopener noreferrer" class="hay-powered-by">
    {{ t("chat.poweredBy") }}
    <span class="hay-powered-by__brand">
      <svg class="hay-powered-by__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#001df5" />
        <!-- The Hay mark, as in the dashboard (layout/OrgSwitcher.vue). -->
        <svg x="6" y="6.5" width="12" height="11" viewBox="0 0 177 161">
          <path
            fill="#fff"
            d="M169.457 154.602C169.457 154.602 46.8109 160.184 0 160.184C38.3848 20.6498 63.663 -65.8613 72.0895 98.7885C105.793 -19.35 127.327 -44.4661 127.327 95.0677C193.799 -54.6986 175.074 82.0447 169.457 154.602Z"
          />
        </svg>
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

.hay-powered-by b {
  font-weight: 600;
}
</style>
