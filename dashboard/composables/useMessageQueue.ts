import { ref } from 'vue';

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  retryCount: number;
  conversationId: string;
}

/**
 * Message queue for offline/failed message handling
 * Stores messages locally and retries them with exponential backoff
 */
export function useMessageQueue() {
  const queue = ref<QueuedMessage[]>([]);
  const STORAGE_KEY = 'hay-dashboard-message-queue';
  const MAX_RETRIES = 3;

  // Load queue from localStorage on init
  const loadQueue = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        queue.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error('[Dashboard MessageQueue] Failed to load queue:', error);
    }
  };

  // Save queue to localStorage
  const saveQueue = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.value));
    } catch (error) {
      console.error('[Dashboard MessageQueue] Failed to save queue:', error);
    }
  };

  // Add message to queue
  const enqueue = (message: Omit<QueuedMessage, 'retryCount'>) => {
    queue.value.push({
      ...message,
      retryCount: 0,
    });
    saveQueue();
    console.log('[Dashboard MessageQueue] Message queued:', message.id);
  };

  // Remove message from queue
  const dequeue = (messageId: string) => {
    queue.value = queue.value.filter((msg) => msg.id !== messageId);
    saveQueue();
    console.log('[Dashboard MessageQueue] Message dequeued:', messageId);
  };

  // Get next message to retry with exponential backoff
  const getNextRetry = (): QueuedMessage | null => {
    const now = Date.now();

    for (const msg of queue.value) {
      // Skip if max retries reached
      if (msg.retryCount >= MAX_RETRIES) {
        console.log('[Dashboard MessageQueue] Max retries reached for:', msg.id);
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
      console.log(
        `[Dashboard MessageQueue] Retry count incremented for ${messageId}: ${msg.retryCount}`,
      );
    }
  };

  // Clear all messages from queue
  const clearQueue = () => {
    queue.value = [];
    localStorage.removeItem(STORAGE_KEY);
    console.log('[Dashboard MessageQueue] Queue cleared');
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
      console.log(`[Dashboard MessageQueue] Cleared ${removed} failed messages`);
    }
  };

  // Initialize
  loadQueue();

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
