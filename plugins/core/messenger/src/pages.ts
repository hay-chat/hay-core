import type { ConnectedPage } from "./graph-client.js";

/**
 * The connected Pages and their tokens, held in the worker's memory.
 *
 * A Page-scoped id (PSID) only means something on its Page, so a customer's
 * channel identity is "messenger:<pageId>:<psid>": the reply goes out through
 * the right Page without core knowing anything about Pages.
 */

const PREFIX = "messenger:";

export function messengerAddress(pageId: string, psid: string): string {
  return `${PREFIX}${pageId}:${psid}`;
}

/** "messenger:<pageId>:<psid>" → its parts, or null when it isn't one. */
export function parseAddress(to: string): { pageId: string; psid: string } | null {
  if (!to.startsWith(PREFIX)) return null;
  const [pageId, psid, ...extra] = to.slice(PREFIX.length).split(":");
  if (!pageId || !psid || extra.length) return null;
  return { pageId, psid };
}

export class PageRegistry {
  private pages = new Map<string, ConnectedPage>();
  private loading: Promise<unknown> = Promise.resolve();

  /** Replace the Pages with the result of `load` (handlers wait for it). */
  refresh(load: () => Promise<ConnectedPage[]>): Promise<ConnectedPage[]> {
    const run = load().then((pages) => {
      this.pages = new Map(pages.map((page) => [page.id, page]));
      return pages;
    });
    this.loading = run.catch(() => undefined);
    return run;
  }

  clear(): void {
    this.pages = new Map();
    this.loading = Promise.resolve();
  }

  /** The Page, once any refresh in progress has finished. */
  async get(pageId: string): Promise<ConnectedPage | null> {
    await this.loading;
    return this.pages.get(pageId) ?? null;
  }
}
