export interface HookPayload {
  organizationId: string;
  conversationId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export type HookHandler = (payload: HookPayload) => Promise<void>;

export class HookManager {
  private static instance: HookManager;
  private hooks: Map<string, Array<HookHandler>> = new Map();

  private constructor() {}

  static getInstance(): HookManager {
    if (!HookManager.instance) {
      HookManager.instance = new HookManager();
    }
    return HookManager.instance;
  }

  register(event: string, handler: HookHandler): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(handler);
  }

  async trigger(event: string, payload: HookPayload): Promise<void> {
    const handlers = this.hooks.get(event) || [];
    await Promise.all(
      handlers.map((handler) =>
        handler(payload).catch((error) => {
          console.error(`Hook handler error for event ${event}:`, error);
        })
      )
    );
  }

  clear(event?: string): void {
    if (event) {
      this.hooks.delete(event);
    } else {
      this.hooks.clear();
    }
  }

  getRegisteredEvents(): string[] {
    return Array.from(this.hooks.keys());
  }
}

export const hookManager = HookManager.getInstance();