<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <!-- Background pattern -->
    <div class="absolute inset-0 bg-gray-50">
      <div
        class="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-br from-blue-50 to-indigo-100 hidden lg:block"
      ></div>
    </div>

    <!-- Content -->
    <div class="relative">
      <!-- Header -->
      <div class="sm:mx-auto sm:w-full sm:max-w-md">
        <div class="flex justify-center">
          <!-- Logo placeholder - replace with actual logo -->
          <div class="flex items-center space-x-2">
            <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span class="text-white font-bold text-lg">H</span>
            </div>
            <span class="text-2xl font-bold text-gray-900">Hay</span>
          </div>
        </div>
      </div>

      <!-- Main content area -->
      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div class="bg-white py-8 px-4 shadow-lg sm:rounded-lg sm:px-10 border border-gray-200">
          <slot />
        </div>
      </div>

      <!-- Footer -->
      <div class="mt-8 text-center text-sm text-gray-600">
        <p>&copy; 2024 Hay Labs. All rights reserved.</p>
        <div class="mt-2 space-x-4">
          <NuxtLink to="/privacy" class="hover:text-gray-900 transition-colors">
            Privacy Policy
          </NuxtLink>
          <NuxtLink to="/terms" class="hover:text-gray-900 transition-colors">
            Terms of Service
          </NuxtLink>
          <NuxtLink to="/support" class="hover:text-gray-900 transition-colors"> Support </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// TODO: Add any authentication layout logic here
// TODO: Add route protection logic
// TODO: Add authentication state management
</script>
