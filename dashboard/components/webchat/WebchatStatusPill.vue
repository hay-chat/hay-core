<template>
  <span
    :class="['whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tone]"
    :data-testid="`webchat-status-${status}`"
  >
    {{ $t(`webchat.status.${status}`) }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { WebchatInstallStatus } from "@/utils/webchat-settings";

const props = defineProps<{ status: WebchatInstallStatus }>();

const tone = computed(
  () =>
    ({
      live: "bg-[rgb(220,252,231)] text-[rgb(22,101,52)]",
      notInstalled: "bg-[rgb(254,243,199)] text-[rgb(120,53,15)]",
      off: "bg-neutral-100 text-neutral-500",
    })[props.status],
);
</script>
