<template>
  <!-- Decorative: the plugin's name always sits next to its logo. -->
  <div
    class="relative flex shrink-0 items-center justify-center overflow-hidden bg-background-tertiary"
    aria-hidden="true"
  >
    <img
      v-if="!failed"
      :src="src"
      alt=""
      class="h-full w-full object-cover"
      loading="lazy"
      @error="failed = true"
    />
    <Package v-else class="h-1/2 w-1/2 text-neutral-muted" />
    <!-- A faint inset outline: it gives white logos an edge and disappears on coloured ones. -->
    <span
      class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10"
    ></span>
  </div>
</template>

<script setup lang="ts">
import { Package } from "lucide-vue-next";
import { useDomain } from "@/composables/useDomain";

const props = defineProps<{ pluginId: string }>();

const { getApiUrl } = useDomain();
const src = computed(() => getApiUrl(`/plugins/thumbnails/${encodeURIComponent(props.pluginId)}`));

const failed = ref(false);
watch(src, () => {
  failed.value = false;
});
</script>
