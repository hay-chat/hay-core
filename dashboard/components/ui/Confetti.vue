<template>
  <canvas ref="canvasRef" class="pointer-events-none fixed inset-0 z-[100] h-full w-full" />
</template>

<script setup lang="ts">
import confetti from "canvas-confetti";

const canvasRef = ref<HTMLCanvasElement>();

let confettiInstance: confetti.CreateTypes | null = null;

// Brand colors from tailwind config
const brandColors = [
  "#fec42e", // primary-700
  "#fec42e", // primary-500
  "#47d4e3", // primary-400
  "#8bcb31", // purple-600
  "#dc4e83", // purple-400
  "#2f5dff", // primary-500
];

const baseDefaults: confetti.Options = {
  colors: brandColors,
  scalar: 1.5,
  gravity: 0.9,
};

function fire(options?: confetti.Options) {
  if (!confettiInstance) return;

  confettiInstance({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    ...baseDefaults,
    ...options,
  });
}

function burst() {
  if (!confettiInstance) return;

  // Fire from both sides for a celebratory effect
  confettiInstance({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0, y: 0.6 },
    ...baseDefaults,
  });
  confettiInstance({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1, y: 0.6 },
    ...baseDefaults,
  });
}

onMounted(() => {
  if (canvasRef.value) {
    confettiInstance = confetti.create(canvasRef.value, { resize: true });
  }
});

onBeforeUnmount(() => {
  if (confettiInstance) {
    confettiInstance.reset();
    confettiInstance = null;
  }
});

defineExpose({ fire, burst });
</script>
