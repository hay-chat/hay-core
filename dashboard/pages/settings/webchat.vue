<template>
  <div />
</template>

<script setup lang="ts">
import type { RouteLocationNormalized } from "vue-router";

// Webchat settings moved to their own page under Channels.
definePageMeta({
  redirect: (to: RouteLocationNormalized) => ({ path: "/channels/webchat", query: to.query }),
});
</script>
