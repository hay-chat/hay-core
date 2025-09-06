<template>
  <AuthProvider>
    <div>
      <!-- Nuxt will automatically handle layouts and page routing -->
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </div>
  </AuthProvider>
</template>

<script setup lang="ts">
// Global app configuration
useHead({
  htmlAttrs: {
    lang: "en",
  },
  link: [
    {
      rel: "icon",
      type: "image/png",
      href: "/favicon.png",
    },
  ],
});

// Auth initialization is now handled by the AuthProvider component
</script>
