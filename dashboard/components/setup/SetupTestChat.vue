<template>
  <section
    class="flex h-[440px] flex-col rounded-xl border border-border bg-background lg:sticky lg:top-5 lg:h-[min(600px,calc(100vh-60px))]"
    :aria-label="$t('setup.chat.title')"
  >
    <h2 class="border-b border-border px-4 py-3 text-base">{{ $t("setup.chat.title") }}</h2>

    <div
      ref="scroller"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      role="log"
      :aria-label="$t('setup.chat.log')"
    >
      <p class="text-sm text-neutral-muted">{{ $t("setup.chat.intro") }}</p>

      <div v-for="entry in entries" :key="entry.message.id" class="space-y-1">
        <ChatMessage
          :message="entry.message"
          :inverted="true"
          :show-timestamp="false"
          @retry="retry"
        />
        <p v-if="entry.handedOff" class="ml-11 text-xs text-neutral-muted">
          {{ $t("setup.chat.handedOff") }}
        </p>
        <p v-if="sourcesFor(entry).length" class="ml-11 text-xs text-neutral-muted">
          {{ $t("setup.chat.source") }}:
          <template v-for="(source, index) in sourcesFor(entry)" :key="source.documentId">
            <span v-if="index > 0">, </span>
            <a
              v-if="source.url"
              :href="source.url"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ pageTitle(source.title) }}
            </a>
            <span v-else class="font-medium text-primary">{{ pageTitle(source.title) }}</span>
          </template>
        </p>
      </div>

      <div v-if="typing" class="ml-11 flex items-center gap-1" role="status">
        <span class="sr-only">{{ $t("setup.chat.typing") }}</span>
        <span
          v-for="n in 3"
          :key="n"
          class="h-1.5 w-1.5 rounded-full bg-neutral-500 motion-safe:animate-bounce"
          :style="{ animationDelay: `${(n - 1) * 0.1}s` }"
          aria-hidden="true"
        />
      </div>

      <div v-if="error" class="flex flex-wrap items-center gap-2" role="alert">
        <p class="text-sm text-destructive">
          {{ error === "start" ? $t("setup.chat.startError") : $t("setup.chat.replyError") }}
        </p>
        <Button variant="outline" size="sm" @click="retry()">{{ $t("setup.chat.retry") }}</Button>
      </div>
    </div>

    <form class="flex items-end gap-2 border-t border-border p-3" @submit.prevent="submit">
      <div class="min-w-0 flex-1 [&_.label-container]:sr-only">
        <Input
          v-model="draft"
          type="text"
          :label="$t('setup.chat.messageLabel')"
          :placeholder="$t('setup.chat.placeholder')"
        />
      </div>
      <Button
        type="submit"
        :loading="sending || awaitingReply"
        :disabled="!draft.trim()"
        :aria-label="$t('setup.chat.send')"
      >
        <ArrowUp class="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ArrowUp } from "lucide-vue-next";
import ChatMessage from "@/components/ChatMessage.vue";
import { useSetupTestChat } from "@/composables/useSetupTestChat";
import type { SetupRow } from "@/stores/setup";
import { pageTitle } from "@/utils/format";

type SetupSource = SetupRow["sources"][number];

const { entries, sending, awaitingReply, typing, error, send, retry } = useSetupTestChat();

const draft = ref("");
const scroller = ref<HTMLElement | null>(null);

const submit = async () => {
  const text = draft.value;
  draft.value = "";
  await send(text);
};

/** What this reply really drew on. A handed-off reply didn't answer from anything. */
const sourcesFor = (entry: (typeof entries.value)[number]): SetupSource[] => {
  if (entry.handedOff) return [];
  if (entry.sources.length) return entry.sources;
  return (entry.message.metadata?.documentsUsed ?? []).map((doc) => ({
    documentId: doc.id,
    title: doc.title,
  }));
};

watch(
  () => [entries.value.length, typing.value, error.value],
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
);

/** "Try it" on a ready row: asks its question, and the reply shows what it really used. */
const ask = (text: string) => send(text);
const busy = computed(() => sending.value || awaitingReply.value);

defineExpose({ ask, busy });
</script>
