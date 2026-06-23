import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { TRPCClientError } from "@trpc/client";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useRouter } from "vue-router";

export interface AssignedUser {
  id: string;
  name: string;
  email: string;
  assignedAt: Date | string | null;
}

/**
 * Owner info attached to the `cause` of a CONFLICT error thrown by the
 * takeover procedure when another user already owns the conversation.
 */
type TakeoverConflictOwner = Pick<AssignedUser, "id" | "name" | "email">;

const getConflictOwner = (cause: unknown): TakeoverConflictOwner | null => {
  if (cause && typeof cause === "object" && "currentOwner" in cause) {
    const owner = (cause as { currentOwner: unknown }).currentOwner;
    if (owner && typeof owner === "object" && "id" in owner) {
      return owner as TakeoverConflictOwner;
    }
  }
  return null;
};

export function useConversationTakeover() {
  const toast = useToast();
  const router = useRouter();
  const { t } = useI18n();

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

      toast.success(t("conversations.toast.takenOver"), t("conversations.toast.takenOverMessage"));
      return true;
    } catch (error: unknown) {
      // Handle conflict - another user has already taken over
      if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") {
        const ownerInfo = getConflictOwner(error.cause);
        if (ownerInfo) {
          currentOwner.value = { ...ownerInfo, assignedAt: null };
          showTakeoverDialog.value = true;
          return false;
        }
      }

      // Handle other errors
      const errorMessage =
        (error instanceof Error && error.message) || t("conversations.toast.takeoverFailedMessage");
      toast.error(t("conversations.toast.takeoverFailed"), errorMessage);
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
          ? t("conversations.toast.releasedToAi")
          : t("conversations.toast.releasedToQueue");

      toast.success(t("conversations.toast.released"), message);
      showReleaseDialog.value = false;

      // Navigate back to conversations list
      router.push("/conversations");
      return true;
    } catch (error: unknown) {
      const errorMessage =
        (error instanceof Error && error.message) || t("conversations.toast.releaseFailedMessage");
      toast.error(t("conversations.toast.releaseFailed"), errorMessage);
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
