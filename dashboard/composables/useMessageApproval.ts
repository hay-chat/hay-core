import { ref } from "vue";
import { HayApi } from "@/utils/api";

export function useMessageApproval() {
  const loading = ref(false);
  const error = ref<Error | null>(null);

  const approveMessage = async (messageId: string, editedContent?: string) => {
    loading.value = true;
    error.value = null;

    try {
      const message = await HayApi.conversations.approveMessage.mutate({
        messageId,
        editedContent,
      });
      return message;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to approve message");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  const blockMessage = async (messageId: string, reason?: string) => {
    loading.value = true;
    error.value = null;

    try {
      const message = await HayApi.conversations.blockMessage.mutate({
        messageId,
        reason,
      });
      return message;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to block message");
      throw error.value;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    approveMessage,
    blockMessage,
  };
}
