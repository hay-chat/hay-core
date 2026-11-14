<template>
  <!-- Our own constant markup, never user input. -->
  <span class="inline-grid place-items-center [&>svg]:h-full [&>svg]:w-full" v-html="markup" />
</template>

<script setup lang="ts">
import { computed } from "vue";

// The webchat's icons for the assistant's avatar and the chat button, drawn the way the
// widget draws them. Keep in sync with webchat/src/utils/icons.ts.
const SPARKLE = '<path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"/>';
const SPARKLES =
  '<path d="M10 3l1.6 4.9L16.5 9.5l-4.9 1.6L10 16l-1.6-4.9L3.5 9.5l4.9-1.6z"/>' +
  '<path d="M18 13l.8 2.2 2.2.8-2.2.8L18 19l-.8-2.2-2.2-.8 2.2-.8z"/>';
const CHAT = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
const ROBOT_FILLED =
  '<path fill-rule="evenodd" d="M11.25 4.3A1.5 1.5 0 1 1 12.75 4.3V7.5H17a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3h4.25zM8.25 12.25a1 1 0 0 0-1 1v1.5a1 1 0 0 0 2 0v-1.5a1 1 0 0 0-1-1zm7.5 0a1 1 0 0 0-1 1v1.5a1 1 0 0 0 2 0v-1.5a1 1 0 0 0-1-1z"/>' +
  '<rect x="1.25" y="12" width="1.5" height="5" rx=".75"/><rect x="21.25" y="12" width="1.5" height="5" rx=".75"/>';
const ROBOT_OUTLINE =
  '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3.5" r="1"/>' +
  '<path d="M9 13v1.5M15 13v1.5M2 13v3M22 13v3"/>';

const props = withDefaults(
  defineProps<{
    name: "sparkle" | "sparkles" | "robot" | "chat";
    variant?: "filled" | "outline";
  }>(),
  { variant: "filled" },
);

const markup = computed(() => {
  const filled = props.variant === "filled";
  const shapes: Record<typeof props.name, string> = {
    sparkle: SPARKLE,
    sparkles: SPARKLES,
    chat: CHAT,
    robot: filled ? ROBOT_FILLED : ROBOT_OUTLINE,
  };
  const paint = filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${paint} aria-hidden="true">${shapes[props.name]}</svg>`;
});
</script>
