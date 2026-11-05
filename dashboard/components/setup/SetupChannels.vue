<template>
  <section :aria-labelledby="headingId" data-testid="setup-channels">
    <h2 :id="headingId" class="text-base">{{ $t("setup.channels.title") }}</h2>
    <ul class="mt-1">
      <li
        v-for="channel in rows"
        :key="channel.id"
        class="flex flex-wrap items-center justify-between gap-3 border-t border-border py-2.5"
      >
        <div class="min-w-0 flex-1 basis-48">
          <p class="font-medium text-neutral-900">{{ channel.name }}</p>
          <p class="text-sm text-neutral-muted">{{ channel.hint }}</p>
        </div>

        <Badge v-if="channel.kind === 'connected'" variant="success">
          {{ $t("setup.channels.connected") }}
        </Badge>
        <NuxtLink
          v-else-if="channel.kind === 'connect' && channel.to"
          :to="channel.to"
          :class="outlineLinkClass"
          class="max-md:w-full"
        >
          {{ $t("setup.channels.connect", { plugin: channel.name }) }}
        </NuxtLink>
        <Button
          v-else-if="channel.kind === 'webchat' && canInstall"
          variant="outline"
          class="max-md:w-full"
          :aria-expanded="installOpen"
          @click="emit('install')"
        >
          {{ $t("setup.channels.addToSite") }}
        </Button>
        <Badge v-else-if="channel.kind === 'connect'" variant="secondary">
          {{ $t("setup.channels.notConnected") }}
        </Badge>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SetupBoard } from "@/stores/setup";
import { useSetupLinks } from "@/composables/useSetupLinks";
import { outlineLinkClass } from "./styles";

const props = defineProps<{
  channels: SetupBoard["channelRefs"];
  canInstall: boolean;
  installOpen: boolean;
}>();

const emit = defineEmits<{ install: [] }>();

const { t } = useI18n();
const { canOpen, connectPath } = useSetupLinks();
const headingId = "setup-channels-heading";

type ChannelRow = {
  id: string;
  name: string;
  hint: string;
  kind: "webchat" | "connected" | "connect";
  to: string | null;
};

/** Webchat is core's own and goes to the install panel; every other channel is a plugin. */
const rows = computed<ChannelRow[]>(() =>
  props.channels.map((channel) => {
    if (!channel.plugin) {
      return {
        id: channel.id,
        name: channel.name,
        hint: t("setup.channels.webchatHint"),
        kind: "webchat",
        to: null,
      };
    }
    return {
      id: channel.id,
      name: channel.name,
      hint: channel.connected
        ? t("setup.channels.connectedHint")
        : t("setup.channels.connectHint", { plugin: channel.name }),
      kind: channel.connected ? "connected" : "connect",
      to: canOpen("/integrations/plugins") ? connectPath(channel.plugin.id) : null,
    };
  }),
);
</script>
