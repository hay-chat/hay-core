import { ref, watch } from "vue";
import { safeStorage, useConsent } from "./useConsent";

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  retryCount: number;
  conversationId: string;
}

/**
 * Message queue for offline/failed message handling.
 * Stores messages locally and retries them with exponential backoff.
 *
 * Storage is gated by the ePrivacy consent model (see useConsent.ts): the
 * queue stays in-memory until the persistent-storage gate opens, at which
 * point it is hydrated from — and persisted back to — localStorage.
 */
export function useMessageQueue() {
  const { canUseLocal } = useConsent();
  const queue = ref<QueuedMessage[]>([]);
  const STORAGE_KEY = "hay-message-queue";
  const MAX_RETRIES = 3;

  // Load queue from localStorage
  const loadQueue = () => {
    try {
      const stored = safeStorage.local.getItem(STORAGE_KEY);
      if (stored) {
        queue.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error("[MessageQueue] Failed to load queue:", error);
    }
  };

  // Save queue to localStorage (no-op when gate is closed — queue stays in memory)
  const saveQueue = () => {
    try {
      safeStorage.local.setItem(STORAGE_KEY, JSON.stringify(queue.value));
    } catch (error) {
      console.error("[MessageQueue] Failed to save queue:", error);
    }
  };

  // Add message to queue
  const enqueue = (message: Omit<QueuedMessage, "retryCount">) => {
    queue.value.push({
      ...message,
      retryCount: 0,
    });
    saveQueue();
    console.log("[MessageQueue] Message queued:", message.id);
  };

  // Remove message from queue
  const dequeue = (messageId: string) => {
    queue.value = queue.value.filter((msg) => msg.id !== messageId);
    saveQueue();
    console.log("[MessageQueue] Message dequeued:", messageId);
  };

  // Get next message to retry with exponential backoff
  const getNextRetry = (): QueuedMessage | null => {
    const now = Date.now();

    for (const msg of queue.value) {
      // Skip if max retries reached
      if (msg.retryCount >= MAX_RETRIES) {
        console.log("[MessageQueue] Max retries reached for:", msg.id);
        continue;
      }

      // Calculate backoff delay: 2^retryCount * 1000ms (1s, 2s, 4s, 8s...)
      const backoffDelay = Math.pow(2, msg.retryCount) * 1000;
      const nextRetryTime = msg.timestamp + backoffDelay;

      if (now >= nextRetryTime) {
        return msg;
      }
    }

    return null;
  };

  // Increment retry count for a message
  const incrementRetry = (messageId: string) => {
    const msg = queue.value.find((m) => m.id === messageId);
    if (msg) {
      msg.retryCount++;
      msg.timestamp = Date.now(); // Update timestamp for next backoff calculation
      saveQueue();
      console.log(`[MessageQueue] Retry count incremented for ${messageId}: ${msg.retryCount}`);
    }
  };

  // Clear all messages from queue
  const clearQueue = () => {
    queue.value = [];
    safeStorage.local.removeItem(STORAGE_KEY);
    console.log("[MessageQueue] Queue cleared");
  };

  // Get messages for specific conversation
  const getQueueForConversation = (conversationId: string): QueuedMessage[] => {
    return queue.value.filter((msg) => msg.conversationId === conversationId);
  };

  // Remove failed messages that exceeded max retries
  const clearFailedMessages = () => {
    const beforeCount = queue.value.length;
    queue.value = queue.value.filter((msg) => msg.retryCount < MAX_RETRIES);
    const removed = beforeCount - queue.value.length;
    if (removed > 0) {
      saveQueue();
      console.log(`[MessageQueue] Cleared ${removed} failed messages`);
    }
  };

  // Initial load: only has effect if the persistent-storage gate is already
  // open (e.g. implicit mode with a prior interaction already simulated, or
  // strict mode with a pre-mount grantConsent()).
  loadQueue();

  // When the gate opens later, hydrate any previously-persisted queue into
  // memory and then flush the current in-memory queue back to storage so the
  // two stay consistent. If the gate closes again (revoke), the in-memory
  // queue keeps working but writes will no-op.
  watch(canUseLocal, (allowed) => {
    if (!allowed) return;
    try {
      const stored = safeStorage.local.getItem(STORAGE_KEY);
      if (stored) {
        const persisted: QueuedMessage[] = JSON.parse(stored);
        // Merge by id — in-memory entries take precedence over stale persisted ones
        const inMemoryIds = new Set(queue.value.map((m) => m.id));
        const merged = [...queue.value, ...persisted.filter((m) => !inMemoryIds.has(m.id))];
        queue.value = merged;
      }
    } catch (error) {
      console.error("[MessageQueue] Failed to hydrate queue after consent:", error);
    }
    saveQueue();
  });

  return {
    queue,
    enqueue,
    dequeue,
    getNextRetry,
    incrementRetry,
    clearQueue,
    getQueueForConversation,
    clearFailedMessages,
  };
}
