/**
 * Addresses of help center pages: `/articles/<title-slug>-<id8>` and
 * `/collections/<title-slug>-<id8>`, where id8 is the first 8 hex characters
 * of the row's uuid. Pages are found by id8 alone, so renaming an article
 * never breaks a link: the old address redirects to the current one.
 */

const SLUG_MAX_LENGTH = 80;
const SLUG_ID_PATTERN = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*)-)?([0-9a-f]{8})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lowercase latin letters and digits joined by dashes; empty when the text has none. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

export function id8(id: string): string {
  return id.slice(0, 8).toLowerCase();
}

/** `<slug>-<id8>`, or just `<id8>` for a title with no latin characters. */
export function slugId(title: string | null | undefined, id: string): string {
  const slug = slugify(title ?? "");
  return slug ? `${slug}-${id8(id)}` : id8(id);
}

export function articlePath(article: { id: string; title: string | null }): string {
  return `/articles/${slugId(article.title, article.id)}`;
}

export function collectionPath(collection: { id: string; title: string | null }): string {
  return `/collections/${slugId(collection.title, collection.id)}`;
}

/** The id8 of a `<slug>-<id8>` path segment, or null when it is not one. */
export function parseSlugId(segment: string): string | null {
  return SLUG_ID_PATTERN.exec(segment)?.[2] ?? null;
}

/**
 * The inclusive uuid range covered by an id8 or by a full uuid, for looking a
 * row up through its primary key index. Null for anything else.
 */
export function idRange(idOrId8: string): { from: string; to: string } | null {
  const value = idOrId8.toLowerCase();
  if (UUID_PATTERN.test(value)) return { from: value, to: value };
  if (!/^[0-9a-f]{8}$/.test(value)) return null;
  return {
    from: `${value}-0000-0000-0000-000000000000`,
    to: `${value}-ffff-ffff-ffff-ffffffffffff`,
  };
}
