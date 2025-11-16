<template>
  <div class="p-4">
    <img v-if="illustration" :src="illustration" class="h-24 w-24 mx-auto" />
    <h3 class="text-xl font-bold text-foreground mt-6 text-center">
      {{ title }}
    </h3>
    <p class="mt-2 text-sm text-neutral-muted text-center">
      {{ description }}
    </p>
    <div class="mt-6 mx-auto text-center">
      <Button :disabled="disabled" @click="actionClick">
        {{ action }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  illustration?: string;
  action?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "click"): void;
}>();

const actionClick = () => {
  emit("click");
};
</script>
