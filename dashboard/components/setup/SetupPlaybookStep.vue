<template>
  <!-- One playbook step, with the same chips the playbook editor draws (assets/css/mentions.css). -->
  <span data-testid="setup-step">
    <template v-for="(part, index) in step" :key="index">
      <template v-if="part.type === 'text'">{{ part.text }}</template>
      <span
        v-else-if="part.type === 'action'"
        class="mention mention-action"
        data-testid="setup-step-action"
        :title="part.tool"
      >
        <img
          class="mention-thumbnail"
          :src="`${apiBaseUrl}/plugins/thumbnails/${encodeURIComponent(part.pluginId)}`"
          alt=""
        />
        {{ getToolLabel(part.pluginId, part.tool) }}
      </span>
      <span v-else-if="part.type === 'document'" class="mention mention-document">
        <span class="mention-icon mention-icon-document" aria-hidden="true" />
        <span class="mention-document-label">{{ part.label }}</span>
      </span>
      <span v-else-if="part.type === 'handoff'" class="mention mention-handoff">
        <span class="mention-icon mention-icon-handoff" aria-hidden="true" />
        {{ part.label }}
      </span>
      <span v-else class="mention mention-form">{{ part.label }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import type { SetupPlaybookStep } from "@/stores/setup";
import { useDomain } from "@/composables/useDomain";
import { useToolLabel } from "@/composables/useToolLabel";

defineProps<{ step: SetupPlaybookStep }>();

const apiBaseUrl = useDomain().getApiUrl();
const { getToolLabel } = useToolLabel();
</script>
