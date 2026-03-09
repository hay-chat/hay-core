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
const { locale } = useI18n();

// Global app configuration
useHead({
  htmlAttrs: {
    lang: locale,
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
