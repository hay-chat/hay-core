<template>
  <!-- Decorative: the name is always written next to it. -->
  <span class="hay-avatar" :class="`hay-avatar--${kind}`" aria-hidden="true">
    <img v-if="src && !failed" :src="src" alt="" @error="failed = true" />
    <!-- Our own icon markup (utils/icons), never user input. -->
    <span v-else-if="kind === 'ai'" class="hay-avatar__icon" v-html="aiIcon" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script lang="ts">
import type { ComputedRef, InjectionKey } from "vue";
import type { AssistantAvatarPreset } from "../types";

/** Provided by Widget.vue: the assistant's icon when it has no picture. */
export const ASSISTANT_AVATAR_PRESET: InjectionKey<ComputedRef<AssistantAvatarPreset>> =
  Symbol("assistant-avatar-preset");
</script>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { assistantAvatarSvg } from "../utils/icons";

const props = defineProps<{
  kind: "ai" | "human";
  name?: string;
  src?: string | null;
}>();

const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);

const initial = computed(() => props.name?.trim().charAt(0).toUpperCase() ?? "");

const preset = inject(ASSISTANT_AVATAR_PRESET, null);
const aiIcon = computed(() => assistantAvatarSvg(preset?.value));
</script>
