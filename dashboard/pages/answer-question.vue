<template>
  <NuxtLayout name="auth">
    <div class="space-y-6" data-testid="answer-question-page">
      <div v-if="loading">
        <Loading :label="$t('common.processing')" />
      </div>

      <!-- Link invalid, expired or the question already handled -->
      <div v-else-if="error || (question && !question.answerable && !sent)" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl">{{ $t("home.answerPage.unavailableTitle") }}</CardTitle>
          <CardDescription class="mt-2">
            {{ error || $t("home.answerPage.alreadyHandled") }}
          </CardDescription>
        </div>
        <div class="flex justify-center">
          <Button variant="outline" class="min-h-11" @click="router.push('/inbox')">
            {{ $t("home.answerPage.openInbox") }}
          </Button>
        </div>
      </div>

      <div v-else-if="sent" class="space-y-4 text-center" data-testid="answer-question-sent">
        <CardTitle class="text-2xl text-green-600">{{ $t("home.answerPage.sentTitle") }}</CardTitle>
        <CardDescription>{{ $t("home.answerPage.sentDescription") }}</CardDescription>
      </div>

      <form v-else-if="question" class="space-y-4" @submit.prevent="submit">
        <div>
          <CardTitle class="text-xl">{{ $t("home.answerPage.title") }}</CardTitle>
          <CardDescription class="mt-2">
            {{
              $t("home.answerPage.description", {
                organization: question.organizationName || "Hay.chat",
              })
            }}
          </CardDescription>
        </div>

        <!-- Untrusted text: plain interpolation only -->
        <blockquote class="whitespace-pre-line border-l-2 border-border pl-3 text-sm">
          {{ question.question }}
        </blockquote>
        <p
          v-if="question.customerMessage && question.customerMessage !== question.question"
          class="whitespace-pre-line text-xs text-neutral-muted"
        >
          {{ $t("home.questions.customerSaid", { message: question.customerMessage }) }}
        </p>

        <Input
          v-model="answer"
          type="textarea"
          :label="$t('home.questions.answerLabel')"
          :placeholder="$t('home.questions.answerPlaceholder')"
          :disabled="submitting"
          data-testid="answer-question-input"
        />
        <Input v-model="sendAsWritten" type="switch" :label="$t('home.questions.sendAsWritten')" />
        <Input
          v-model="saveToKnowledge"
          type="checkbox"
          :label="$t('home.questions.saveToKnowledge')"
        />
        <p class="text-xs text-neutral-muted">
          {{
            sendAsWritten ? $t("home.questions.asWrittenHelp") : $t("home.questions.rephraseHelp")
          }}
        </p>

        <Button
          type="submit"
          class="min-h-11 w-full"
          :loading="submitting"
          :disabled="!answer.trim()"
          data-testid="answer-question-send"
        >
          {{ $t("home.questions.send") }}
        </Button>
      </form>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";

/**
 * One-field answer page behind the team email link (D19-5): no login, the
 * signed link is valid for 24 hours and the question can be answered once.
 */
definePageMeta({
  layout: false,
  public: true,
});

interface TokenQuestion {
  organizationName: string | null;
  question: string;
  customerMessage: string | null;
  askedAt: string;
  answerable: boolean;
  status: string;
}

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const loading = ref(true);
const submitting = ref(false);
const sent = ref(false);
const error = ref("");
const question = ref<TokenQuestion | null>(null);
const answer = ref("");
const sendAsWritten = ref(false);
const saveToKnowledge = ref(true);

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : t("home.answerPage.invalidLink");
}

onMounted(async () => {
  if (!token.value) {
    error.value = t("home.answerPage.invalidLink");
    loading.value = false;
    return;
  }
  try {
    question.value = (await Hay.teamQuestions.byToken.query({
      token: token.value,
    })) as TokenQuestion;
  } catch (err) {
    error.value = message(err);
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!answer.value.trim()) return;
  submitting.value = true;
  try {
    await Hay.teamQuestions.answerByToken.mutate({
      token: token.value,
      answer: answer.value,
      sendAsWritten: sendAsWritten.value,
      saveToKnowledge: saveToKnowledge.value,
    });
    sent.value = true;
  } catch (err) {
    error.value = message(err);
  } finally {
    submitting.value = false;
  }
}

useHead({ title: t("home.answerPage.headTitle") });
</script>
