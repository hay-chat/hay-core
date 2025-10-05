import { ref } from "vue";
import { useToast } from "@/composables/useToast";
import { useRouter } from "vue-router";

export interface NotificationOptions {
  title: string;
  body?: string;
  conversationId?: string;
  playSound?: boolean;
  showToast?: boolean;
  showBrowser?: boolean;
}

const notificationPermission = ref<NotificationPermission>("default");
const audioContext = ref<AudioContext | null>(null);

export function useNotifications() {
  const toast = useToast();
  const router = useRouter();

  /**
   * Request browser notification permission
   */
  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!("Notification" in window)) {
      console.warn("Browser does not support notifications");
      return "denied";
    }

    if (Notification.permission === "granted") {
      notificationPermission.value = "granted";
      return "granted";
    }

    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      notificationPermission.value = permission;
      return permission;
    }

    notificationPermission.value = "denied";
    return "denied";
  };

  /**
   * Play notification sound
   * Uses Web Audio API for better control and reliability
   */
  const playNotificationSound = async () => {
    try {
      // Initialize AudioContext if needed
      if (!audioContext.value) {
        audioContext.value = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContext.value;

      // Create a simple notification beep using oscillator
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Configure sound: short, pleasant beep
      oscillator.frequency.value = 800; // 800 Hz
      oscillator.type = "sine";

      // Envelope for smooth sound
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);

      // Second beep for a double-beep effect
      setTimeout(() => {
        const oscillator2 = ctx.createOscillator();
        const gainNode2 = ctx.createGain();

        oscillator2.connect(gainNode2);
        gainNode2.connect(ctx.destination);

        oscillator2.frequency.value = 1000; // Slightly higher pitch
        oscillator2.type = "sine";

        gainNode2.gain.setValueAtTime(0, ctx.currentTime);
        gainNode2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        gainNode2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

        oscillator2.start(ctx.currentTime);
        oscillator2.stop(ctx.currentTime + 0.15);
      }, 100);
    } catch (error) {
      console.error("Failed to play notification sound:", error);
    }
  };

  /**
   * Show browser notification
   */
  const showBrowserNotification = (options: NotificationOptions): Notification | null => {
    if (Notification.permission !== "granted") {
      return null;
    }

    const notification = new Notification(options.title, {
      body: options.body,
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: options.conversationId || "general",
      requireInteraction: false,
      silent: true, // We handle sound separately
    });

    // Handle notification click
    notification.onclick = () => {
      window.focus();
      if (options.conversationId) {
        router.push(`/conversations/${options.conversationId}`);
      }
      notification.close();
    };

    return notification;
  };

  /**
   * Show all types of notifications based on options
   */
  const notify = async (options: NotificationOptions) => {
    const {
      title,
      body,
      conversationId,
      playSound = true,
      showToast = true,
      showBrowser = true,
    } = options;

    // Play sound
    if (playSound) {
      await playNotificationSound();
    }

    // Show toast notification (always visible in-app)
    if (showToast) {
      toast.warning(title, body, 10000); // 10 second duration
    }

    // Show browser notification if permitted and requested
    if (showBrowser) {
      // Request permission if not already granted
      if (notificationPermission.value === "default") {
        await requestPermission();
      }

      if (notificationPermission.value === "granted") {
        showBrowserNotification(options);
      }
    }
  };

  /**
   * Notify about conversation needing human attention
   */
  const notifyConversationNeedsAttention = async (conversation: {
    id: string;
    title?: string;
    customerName?: string;
  }) => {
    const title = "Human Attention Needed";
    const body = conversation.title
      ? `Conversation "${conversation.title}" requires human assistance`
      : `New conversation requires human assistance`;

    await notify({
      title,
      body,
      conversationId: conversation.id,
      playSound: true,
      showToast: true,
      showBrowser: true,
    });
  };

  return {
    notificationPermission,
    requestPermission,
    playNotificationSound,
    showBrowserNotification,
    notify,
    notifyConversationNeedsAttention,
  };
}
