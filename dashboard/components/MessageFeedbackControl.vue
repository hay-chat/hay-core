<template>
  <div class="message-feedback-control">
    <div v-if="!feedbackSubmitted" class="feedback-buttons">
      <Button
        variant="ghost"
        class="feedback-btn feedback-btn-good"
        size="sm"
        :disabled="isSubmitting"
        @click="handleFeedback('good')"
      >
        <ThumbsUp class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        class="feedback-btn feedback-btn-bad"
        size="sm"
        :disabled="isSubmitting"
        @click="handleFeedback('bad')"
      >
        <ThumbsDown class="h-4 w-4" />
      </Button>
    </div>

    <div v-else class="feedback-submitted">
      <Check class="h-3 w-3 text-green-600 mr-1" />
      <span class="text-xs text-neutral-muted">Feedback recorded</span>
      <a
        href="javascript:void(0)"
        class="text-xs ml-1 underline text-primary"
        @click="resetFeedback"
      >
        Edit
      </a>
    </div>

    <!-- Comment Dialog -->
    <Dialog v-model:open="showCommentDialog">
      <DialogContent>
        <div class="space-y-4">
          <div class="space-y-2">
            <span class="text-sm font-medium">Rating:</span>
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                :class="{ 'bg-green-50 !border-green-600': pendingRating === FeedbackRating.GOOD }"
                @click="pendingRating = FeedbackRating.GOOD"
              >
                <ThumbsUp
                  class="h-4 w-4 mr-2"
                  :class="{ 'text-green-600': pendingRating === FeedbackRating.GOOD }"
                />
                Good
              </Button>
              <Button
                variant="outline"
                size="sm"
                :class="{ 'bg-red-50 !border-red-600': pendingRating === FeedbackRating.BAD }"
                @click="pendingRating = FeedbackRating.BAD"
              >
                <ThumbsDown
                  class="h-4 w-4 mr-2"
                  :class="{ 'text-red-600': pendingRating === FeedbackRating.BAD }"
                />
                Bad
              </Button>
            </div>
          </div>
          <Input
            v-model="comment"
            type="textarea"
            label="Comment (optional)"
            placeholder="What could be improved?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="cancelFeedback">Cancel</Button>
          <Button @click="submitFeedback">Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ThumbsUp, ThumbsDown, Check } from "lucide-vue-next";
import { useMessageFeedback, FeedbackRating } from "@/composables/useMessageFeedback";

const props = defineProps<{
  messageId: string;
}>();

const emit = defineEmits<{
  feedbackSubmitted: [rating: FeedbackRating, comment?: string];
}>();

const { submitFeedback: submitFeedbackToAPI } = useMessageFeedback();

const feedbackSubmitted = ref(false);
const isSubmitting = ref(false);
const showCommentDialog = ref(false);
const pendingRating = ref<FeedbackRating | null>(null);
const comment = ref("");

const handleFeedback = async (rating: "good" | "bad") => {
  pendingRating.value = rating === "good" ? FeedbackRating.GOOD : FeedbackRating.BAD;
  showCommentDialog.value = true;
};

const submitFeedback = async () => {
  if (!pendingRating.value) return;

  isSubmitting.value = true;
  try {
    await submitFeedbackToAPI({
      messageId: props.messageId,
      rating: pendingRating.value,
      comment: comment.value.trim() || undefined,
    });

    feedbackSubmitted.value = true;
    showCommentDialog.value = false;
    emit("feedbackSubmitted", pendingRating.value, comment.value.trim() || undefined);
  } catch (error) {
    console.error("Failed to submit feedback:", error);
  } finally {
    isSubmitting.value = false;
  }
};

const cancelFeedback = () => {
  showCommentDialog.value = false;
  comment.value = "";
  pendingRating.value = null;
};

const resetFeedback = () => {
  feedbackSubmitted.value = false;
  comment.value = "";
  pendingRating.value = null;
};
</script>

<style scoped>
.message-feedback-control {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.feedback-buttons {
  display: flex;
  gap: 0.25rem;
}

.feedback-btn {
  padding: 0.25rem;
  height: auto;
}

.feedback-btn-good:hover {
  color: var(--color-green);
  background-color: var(--color-green-50);
}

.feedback-btn-bad:hover {
  color: var(--color-destructive);
  background-color: var(--color-destructive-50);
}

.feedback-submitted {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: var(--neutral-muted);
}
</style>
