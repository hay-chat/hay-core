<template>
  <section class="space-y-4 pb-6" data-testid="webchat-content">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.content.home") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.content.homeHint") }}</p>
    </div>
    <Input
      id="webchat-home-heading"
      v-model="form.homeHeading"
      :label="$t('webchat.content.heading')"
      :placeholder="$t('webchat.content.headingPlaceholder')"
      :hint="$t('webchat.content.headingHint')"
      :maxlength="100"
    />
    <Input
      id="webchat-title"
      v-model="form.widgetTitle"
      :label="$t('webchat.content.chatTitle')"
      :placeholder="$t('webchat.content.chatTitlePlaceholder')"
      :hint="$t('webchat.content.chatTitleHint')"
      :maxlength="100"
    />
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <span class="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
      <span class="min-w-0 flex-1 text-neutral-700">{{ $t("webchat.content.statusLine") }}</span>
      <Button variant="link" size="sm" @click="router.push('/settings/business-hours')">
        {{ $t("nav.businessHours") }}
      </Button>
    </div>
  </section>

  <section class="space-y-4 py-6">
    <h2 class="text-base">{{ $t("webchat.content.greeting") }}</h2>
    <Input v-model="form.showGreeting" type="switch" :label="$t('webchat.content.showGreeting')" />
    <Input
      v-if="form.showGreeting"
      id="webchat-greeting"
      v-model="form.greetingMessage"
      type="textarea"
      :label="$t('webchat.content.greetingMessage')"
      :placeholder="$t('webchat.content.greetingPlaceholder')"
      :rows="3"
      :maxlength="2000"
    />
    <Input
      id="webchat-teaser"
      v-model="form.teaserMessage"
      type="textarea"
      :label="$t('webchat.content.teaser')"
      :placeholder="$t('webchat.content.teaserPlaceholder')"
      :hint="$t('webchat.content.teaserHint')"
      :rows="2"
      :maxlength="200"
    />
  </section>

  <section class="flex flex-wrap items-center gap-3 py-6">
    <div class="min-w-0 flex-1 basis-60 space-y-1">
      <h2 class="text-base">{{ $t("webchat.content.beforeChat") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.content.beforeChatHint") }}</p>
    </div>
    <span
      :class="[
        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
        form.preChatForm
          ? 'bg-[rgb(220,252,231)] text-[rgb(22,101,52)]'
          : 'bg-neutral-100 text-neutral-500',
      ]"
    >
      {{ form.preChatForm ? $t("webchat.content.formOn") : $t("webchat.content.formOff") }}
    </span>
    <Button variant="outline" size="sm" data-testid="webchat-form-open" @click="formOpen = true">
      {{ form.preChatForm ? $t("webchat.content.editForm") : $t("webchat.content.setUpForm") }}
    </Button>
  </section>

  <section class="space-y-4 py-6">
    <h2 class="text-base">{{ $t("webchat.content.endOfChat") }}</h2>
    <Input v-model="form.csatEnabled" type="switch" :label="$t('webchat.content.csatEnabled')" />
    <Input
      v-if="form.csatEnabled"
      id="webchat-csat-question"
      v-model="form.csatQuestion"
      :label="$t('webchat.content.csatQuestion')"
      :placeholder="$t('webchat.content.csatQuestionPlaceholder')"
      :hint="$t('webchat.content.csatQuestionHint')"
      :maxlength="300"
    />
  </section>

  <section class="flex flex-wrap items-center gap-3 py-6">
    <div class="min-w-0 flex-1 basis-60 space-y-1">
      <h2 class="text-base">{{ $t("webchat.content.aiLabel") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.content.aiLabelHint") }}</p>
    </div>
    <Button variant="link" size="sm" @click="router.push('/settings/customer-privacy')">
      {{ $t("nav.customerPrivacy") }}
    </Button>
  </section>

  <Sheet v-model:open="formOpen" size="xl">
    <SheetHeader @close="formOpen = false">
      <SheetTitle>{{ $t("webchat.preChatForm") }}</SheetTitle>
      <SheetDescription>{{ $t("webchat.content.formSheetHint") }}</SheetDescription>
    </SheetHeader>
    <SheetContent>
      <PreChatFormBuilder v-model="form.preChatForm" />
    </SheetContent>
    <SheetFooter>
      <Button @click="formOpen = false">{{ $t("webchat.content.formDone") }}</Button>
    </SheetFooter>
  </Sheet>
</template>

<script setup lang="ts">
import { ref } from "vue";
import PreChatFormBuilder from "@/components/settings/PreChatFormBuilder.vue";
import { useWebchatSettings } from "@/composables/useWebchatSettings";

const router = useRouter();
const form = useWebchatSettings().form;
const formOpen = ref(false);
</script>
