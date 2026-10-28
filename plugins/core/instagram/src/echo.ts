/**
 * Telling Hay.chat's own sends apart from the owner's replies (D11-11).
 *
 * Meta echoes EVERY message the business account sends (`message.is_echo`):
 * the ones Hay.chat sent through the API and the ones the owner typed in the
 * Instagram app. Ours must be dropped (they are already in the conversation);
 * the owner's become human messages so the AI stops answering over them.
 *
 * Checks, cheapest first:
 *   1. `message.app_id` equals this app's id → ours.
 *   2. the mid is one this worker just sent → ours. A send that is still in
 *      flight for the same recipient is awaited first, so an echo that beats
 *      the Graph response is still recognised.
 *   3. core skips an echo whose mid matches a stored outbound message.
 */

const MAX_TRACKED = 500;

export class SentMessageTracker {
  private readonly mids = new Set<string>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /** Run a send for `recipient`, remembering every mid it returns. */
  async track<T>(recipient: string, send: () => Promise<T>): Promise<T> {
    const previous = this.inFlight.get(recipient) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(send);
    this.inFlight.set(recipient, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(recipient) === run) this.inFlight.delete(recipient);
    }
  }

  remember(mid: string | undefined): void {
    if (!mid) return;
    this.mids.add(mid);
    if (this.mids.size > MAX_TRACKED) {
      const oldest = this.mids.values().next().value;
      if (oldest !== undefined) this.mids.delete(oldest);
    }
  }

  /** True when `mid` was sent by this worker (waits for an in-flight send to the recipient). */
  async isOwn(mid: string | undefined, recipient: string | undefined): Promise<boolean> {
    if (recipient) {
      const pending = this.inFlight.get(recipient);
      if (pending) await pending.catch(() => undefined);
    }
    return !!mid && this.mids.has(mid);
  }
}

/** True when the echo carries this app's id (Meta adds `app_id` to API sends). */
export function isOwnApp(appId: unknown, ownAppIds: Array<string | null | undefined>): boolean {
  if (appId === undefined || appId === null || appId === "") return false;
  const id = String(appId);
  return ownAppIds.some((own) => !!own && own === id);
}
