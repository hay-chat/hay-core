<template>
  <div></div>
</template>

<script setup lang="ts">
import { useAppStore } from "@/stores/app";

// Smart homepage that redirects based on onboarding status
const appStore = useAppStore();
const router = useRouter();

// Perform redirect immediately
if (appStore.onboardingCompleted) {
  router.replace("/dashboard");
} else {
  router.replace("/getting-started");
}
</script>
