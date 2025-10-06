import { ref } from "vue";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useRouter } from "vue-router";

export interface AssignedUser {
  id: string;
  name: string;
  email: string;
  assignedAt: Date | string | null;
}

export function useConversationTakeover() {
  const toast = useToast();
  const router = useRouter();

  const loading = ref(false);
  const showTakeoverDialog = ref(false);
  const showReleaseDialog = ref(false);
  const currentOwner = ref<AssignedUser | null>(null);
  const releaseMode = ref<"ai" | "queue">("queue");

  /**
   * Take over a conversation
   */
  const takeover = async (conversationId: string, force = false): Promise<boolean> => {
    loading.value = true;
    try {
      await HayApi.conversations.takeover.mutate({
        conversationId,
        force,
      });

      toast.success("Conversation taken over", "You are now handling this conversation");
      return true;
    } catch (error: any) {
      // Handle conflict - another user has already taken over
      if (error?.data?.code === "CONFLICT") {
        const ownerInfo = error?.cause?.currentOwner;
        if (ownerInfo) {
          currentOwner.value = ownerInfo;
          showTakeoverDialog.value = true;
          return false;
        }
      }

      // Handle other errors
      const errorMessage = error?.message || "Failed to take over conversation";
      toast.error("Takeover failed", errorMessage);
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Confirm takeover from another user
   */
  const confirmTakeover = async (conversationId: string): Promise<boolean> => {
    showTakeoverDialog.value = false;
    return await takeover(conversationId, true);
  };

  /**
   * Cancel takeover attempt
   */
  const cancelTakeover = () => {
    showTakeoverDialog.value = false;
    currentOwner.value = null;
  };

  /**
   * Show release dialog
   */
  const showRelease = () => {
    showReleaseDialog.value = true;
  };

  /**
   * Release conversation
   */
  const release = async (conversationId: string, mode: "ai" | "queue"): Promise<boolean> => {
    loading.value = true;
    try {
      await HayApi.conversations.release.mutate({
        conversationId,
        returnToMode: mode,
      });

      const message =
        mode === "ai"
          ? "Conversation returned to AI"
          : "Conversation returned to queue";

      toast.success("Conversation released", message);
      showReleaseDialog.value = false;

      // Navigate back to conversations list
      router.push("/conversations");
      return true;
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to release conversation";
      toast.error("Release failed", errorMessage);
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Confirm release
   */
  const confirmRelease = async (conversationId: string): Promise<boolean> => {
    return await release(conversationId, releaseMode.value);
  };

  /**
   * Cancel release
   */
  const cancelRelease = () => {
    showReleaseDialog.value = false;
    releaseMode.value = "queue";
  };

  /**
   * Get assigned user for a conversation
   */
  const getAssignedUser = async (conversationId: string): Promise<AssignedUser | null> => {
    try {
      const user = await HayApi.conversations.getAssignedUser.query({ conversationId });
      return user;
    } catch (error) {
      console.error("Failed to get assigned user:", error);
      return null;
    }
  };

  return {
    // State
    loading,
    showTakeoverDialog,
    showReleaseDialog,
    currentOwner,
    releaseMode,

    // Methods
    takeover,
    confirmTakeover,
    cancelTakeover,
    showRelease,
    release,
    confirmRelease,
    cancelRelease,
    getAssignedUser,
  };
}
