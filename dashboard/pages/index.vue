<template>
  <div></div>
</template>

<script setup lang="ts">
import { useAppStore } from "@/stores/app";

/**
 * Landing route. Onboarding first; then phones go to the Inbox (what needs a
 * human right now) and desktops to the metrics Dashboard. The cut is the same
 * `md` breakpoint the layout uses to switch between top bar and sidebar.
 */
const appStore = useAppStore();
const router = useRouter();

const PHONE_MEDIA_QUERY = "(max-width: 767px)";
const isPhone = typeof window !== "undefined" && window.matchMedia(PHONE_MEDIA_QUERY).matches;

if (!appStore.onboardingCompleted) {
  router.replace("/getting-started");
} else {
  router.replace(isPhone ? "/inbox" : "/dashboard");
}
</script>
