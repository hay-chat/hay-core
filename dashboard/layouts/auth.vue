<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 login-bg">
    <!-- Content -->
    <div class="relative">
      <!-- Header -->
      <div class="sm:mx-auto sm:w-full sm:max-w-md">
        <div class="flex justify-center">
          <div class="flex items-center space-x-2">
            <svg
              width="87"
              height="30"
              viewbox="0 0 87 30"
              class="max-h-10 w-auto"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="3.05176e-05" width="29.3915" height="29.3915" rx="4.66345" fill="#001BF4" />
              <path
                d="M22.0127 20.6498C22.0127 20.6498 10.7607 21.1618 6.46616 21.1618C9.9877 8.36058 12.3068 0.423778 13.0799
                15.5293C16.172 4.69087 18.1475 2.38665 18.1475 15.1879C24.2459 1.44788 22.528 13.9931 22.0127 20.6498Z"
                fill="white"
              />
              <path
                d="M71.8383 28.6598L73.3393 26.1669C73.3393 26.1669 74.1971 26.9979 75.0281 26.9979C76.1271 26.9979 76.5828 26.6762
                77.1993 25.1215L77.7086 23.8081L71.5166 10.8077H75.0817L79.3705 20.109L82.7211 10.8077H86.179L80.0138 26.3546C78.9148
                29.1423 77.1189 30.0001 75.2425 30.0001C73.3125 30.0001 71.8383 28.6598 71.8383 28.6598Z"
                fill="#0F282C"
              />
              <path
                d="M67.784 10.8076H70.7593V23.5132H67.784V21.8513C67.784 21.8513 66.685 23.8348 63.9509 23.8348C60.6539 23.8348 57.7589
                21.0739 57.7589 17.1604C57.7589 13.2468 60.6539 10.4859 63.9509 10.4859C66.6046 10.4859 67.784 12.4695 67.784
                12.4695V10.8076ZM67.5427 19.0635V15.2572C67.5427 15.2572 66.6046 13.4881 64.5406 13.4881C62.3694 13.4881 61.0291 15.0696
                61.0291 17.1604C61.0291 19.2512 62.3694 20.8327 64.5406 20.8327C66.6046 20.8327 67.5427 19.0635 67.5427 19.0635Z"
                fill="#0F282C"
              />
              <path
                d="M52.8934 12.3891V4.74964H56.11V23.5132H52.8934V15.4448H44.8787V23.5132H41.6621V4.74964H44.8787V12.3891H52.8934Z"
                fill="#0F282C"
              />
            </svg>
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
        <p>&copy; 2025 Hay Chat. All rights reserved.</p>
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

<style>
.login-bg {
  background-image: url("/images/login-background.svg");
  background-size: cover;
  background-position: center;
}
</style>
