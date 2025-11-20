import { ref, onUnmounted } from 'vue';

interface Message {
  id: string;
  content: string;
  created_at: string;
  [key: string]: any;
}

interface SyncOptions {
  conversationId: string;
  currentMessages: Message[];
  fetchMessages: () => Promise<Message[]>;
  onMessagesUpdated: (messages: Message[]) => void;
  syncInterval?: number; // ms, default 30s
  enabled?: boolean;
}

/**
 * Periodic message sync to detect discrepancies and keep UI in sync
 * Compares local messages with server and reconciles differences
 */
export function useMessageSync(options: SyncOptions) {
  const {
    conversationId,
    currentMessages,
    fetchMessages,
    onMessagesUpdated,
    syncInterval = 30000, // 30 seconds
    enabled = true,
  } = options;

  const isSyncing = ref(false);
  const lastSyncTime = ref<number>(Date.now());
  let syncTimer: ReturnType<typeof setInterval> | null = null;

  // Perform sync
  const sync = async () => {
    if (isSyncing.value || !enabled) return;

    try {
      isSyncing.value = true;
      console.log('[Dashboard MessageSync] Starting sync for conversation:', conversationId);

      // Fetch messages from server
      const serverMessages = await fetchMessages();

      // Compare with current messages
      const localMessageIds = new Set(currentMessages.map((m) => m.id));
      const serverMessageIds = new Set(serverMessages.map((m) => m.id));

      // Find missing messages (on server but not local)
      const missingMessages = serverMessages.filter((msg) => !localMessageIds.has(msg.id));

      // Find extra messages (local but not on server - shouldn't happen normally)
      const extraMessages = currentMessages.filter((msg) => !serverMessageIds.has(msg.id));

      if (missingMessages.length > 0) {
        console.log(
          `[Dashboard MessageSync] Found ${missingMessages.length} missing messages, syncing...`,
        );
        // Merge missing messages into current messages, maintaining chronological order
        const merged = [...currentMessages, ...missingMessages].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        onMessagesUpdated(merged);
      }

      if (extraMessages.length > 0) {
        console.warn(
          `[Dashboard MessageSync] Found ${extraMessages.length} extra local messages (may be pending):`,
          extraMessages.map((m) => m.id),
        );
        // Don't remove extra messages - they might be pending sends
      }

      lastSyncTime.value = Date.now();
      console.log('[Dashboard MessageSync] Sync completed successfully');
    } catch (error) {
      console.error('[Dashboard MessageSync] Sync failed:', error);
    } finally {
      isSyncing.value = false;
    }
  };

  // Start periodic sync
  const startSync = () => {
    if (!enabled) return;

    console.log(`[Dashboard MessageSync] Starting periodic sync (interval: ${syncInterval}ms)`);
    syncTimer = setInterval(sync, syncInterval);

    // Do initial sync
    sync();
  };

  // Stop periodic sync
  const stopSync = () => {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
      console.log('[Dashboard MessageSync] Periodic sync stopped');
    }
  };

  // Auto-start on mount if enabled
  if (enabled) {
    startSync();
  }

  // Cleanup on unmount
  onUnmounted(() => {
    stopSync();
  });

  return {
    isSyncing,
    lastSyncTime,
    sync,
    startSync,
    stopSync,
  };
}
