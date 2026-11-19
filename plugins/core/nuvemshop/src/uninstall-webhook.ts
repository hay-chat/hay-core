/**
 * Registers the `app/uninstalled` webhook for a store.
 *
 * Unlike the LGPD webhooks (configured once on the partner app), store
 * webhooks are created per store through the API: `POST /webhooks` with
 * `{ event, url }`. The URL must be HTTPS and not a local address. The docs do
 * not say what creating the same webhook twice does, so the list is read first.
 *
 * @see https://tiendanube.github.io/api-documentation/resources/webhook
 */

export const UNINSTALL_EVENT = "app/uninstalled";

interface StoreWebhook {
  id: number;
  event: string;
  url: string;
}

export interface WebhookApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

/** The public webhook URL of this plugin, or null when this server has no usable one. */
export function uninstallWebhookUrl(
  publicUrl: string | undefined,
  pluginId: string,
): string | null {
  if (!publicUrl) return null;
  let base: URL;
  try {
    base = new URL(publicUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" || base.hostname === "localhost") return null;
  return `${base.origin}/v1/plugins/${pluginId}/webhook`;
}

/** Create the webhook unless the store already has it. Returns whether it was created. */
export async function ensureUninstallWebhook(api: WebhookApi, url: string): Promise<boolean> {
  const existing = await api.get<StoreWebhook[]>("/webhooks?per_page=200");
  if (
    Array.isArray(existing) &&
    existing.some((hook) => hook.event === UNINSTALL_EVENT && hook.url === url)
  ) {
    return false;
  }
  await api.post<StoreWebhook>("/webhooks", { event: UNINSTALL_EVENT, url });
  return true;
}
