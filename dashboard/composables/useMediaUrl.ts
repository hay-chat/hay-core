import { fetchMedia } from "@/utils/api";
import { useUserStore } from "@/stores/user";

/**
 * Resolve a message attachment to a URL the browser can render.
 *
 * Hay uploads are private: their bytes come from the authenticated
 * /v1/media/:id route and are shown through an object URL. Attachments whose
 * id is not a Hay upload (external URLs) are used as-is.
 *
 * Object URLs are cached per organization + upload for the lifetime of the
 * page, so re-rendering a conversation doesn't refetch its media.
 */

interface AttachmentRef {
  id?: string;
  url: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cache = new Map<string, Promise<string>>();

export function resolveMediaUrl(attachment: AttachmentRef): Promise<string> {
  if (!attachment.id || !UUID_PATTERN.test(attachment.id)) {
    return Promise.resolve(attachment.url);
  }

  const organizationId = useUserStore().activeOrganization?.id ?? "";
  const key = `${organizationId}:${attachment.id}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = fetchMedia(attachment.id).then((blob) =>
    blob ? URL.createObjectURL(blob) : attachment.url,
  );
  // Don't cache failures, so a later render can retry.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  return pending;
}
