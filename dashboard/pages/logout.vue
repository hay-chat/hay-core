<template>
  <div class="flex min-h-screen items-center justify-center" aria-busy="true">
    <p class="text-sm text-muted-foreground" aria-live="polite">{{ $t("suspended.loggingOut") }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";

// Public so the auth middleware — and with it the suspended-organization
// redirect — never runs here: an owner bounced to the external billing page
// can always get out through /logout (linked from that page).
definePageMeta({
  layout: false,
  public: true,
});

const authStore = useAuthStore();

onMounted(() => authStore.logout());
</script>
