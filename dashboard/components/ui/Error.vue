<template>
  <div class="flex items-center gap-4 justify-center m-auto flex-col p-4">
    <svg
      width="91"
      height="105"
      viewBox="0 0 91 105"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="max-h-12"
    >
      <path
        d="M2.5 37.5L29.5 53.5L0 75.5L5.5 80L32.5 63.5L29.5 102.5H34.5L44 77L56.5 105L71 101L56.5 63.5L82 73L90.5 66.5L59.5 47L85.5 21L78.5 15L53 33L56.5 0L45.5 2.5L38.5 29.5L24.5 8.5L18 11.5L27 39.5L4 33L2.5 37.5Z"
        fill="#D74848"
      />
    </svg>
    <p v-if="label" class="font-secondary font-bold text-lg text-muted-foreground">
      {{ label }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps({
  label: {
    type: String,
    default: "Something went wrong...",
  },
});
</script>
