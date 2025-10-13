import { ref } from "vue";
import { HayApi } from "@/utils/api";

export enum FeedbackRating {
  GOOD = "good",
  BAD = "bad",
  NEUTRAL = "neutral",
}

interface CreateFeedbackInput {
  messageId: string;
  rating: FeedbackRating;
  comment?: string;
}

interface MessageFeedback {
  id: string;
  messageId: string;
  organizationId: string;
  reviewerId: string;
  rating: FeedbackRating;
  comment: string | null;
  createdAt: Date;
}

export function useMessageFeedback() {
  const loading = ref(false);
  const error = ref<Error | null>(null);

  const submitFeedback = async (input: CreateFeedbackInput): Promise<MessageFeedback> => {
    loading.value = true;
    error.value = null;

    try {
      const feedback = await HayApi.messageFeedback.create.mutate(input);
      return {
        ...feedback,
        createdAt: new Date(feedback.createdAt as any),
      };
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to submit feedback");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  const getFeedback = async (messageId: string): Promise<MessageFeedback[]> => {
    loading.value = true;
    error.value = null;

    try {
      const feedback = await HayApi.messageFeedback.getByMessage.query({ messageId });
      return feedback.map((f: any) => ({
        ...f,
        createdAt: new Date(f.createdAt),
      }));
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to get feedback");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  const getFeedbackStats = async () => {
    loading.value = true;
    error.value = null;

    try {
      const stats = await HayApi.messageFeedback.stats.query();
      return stats;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to get feedback stats");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    submitFeedback,
    getFeedback,
    getFeedbackStats,
  };
}
