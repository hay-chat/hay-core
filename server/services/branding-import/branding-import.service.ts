import { createLogger } from "@server/lib/logger";
import { safeFetch } from "@server/utils/ssrf";
import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import { storageService } from "@server/services/storage.service";
import {
  MAX_SKIPPED_ICON_SIZE,
  decodeIcon,
  paletteOfImage,
  parseIconLinks,
  parseManifestIcons,
  rankIconCandidates,
  type DecodedIcon,
  type IconCandidate,
} from "./branding-extract";

/**
 * Website branding import (C2): the organization's site icon becomes the
 * webchat logo and its colours the brand palette and colour. Runs when the
 * organization website is saved, and once lazily when webchat settings are
 * read with nothing imported or chosen yet. Never overwrites a logo or colour
 * the merchant set ("custom" sources). Failures are logged and leave the
 * settings as they are.
 */

const logger = createLogger("branding-import");

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_ICON_ATTEMPTS = 5;
/** Public folder: the logo is shown to anonymous shoppers. */
const LOGO_FOLDER = "organizations";
const USER_AGENT = "Mozilla/5.0 (compatible; HayBrandingImport/1.0)";

interface Fetched {
  body: Buffer;
  url: string;
  /** Whether the body was cut at the byte limit. */
  truncated: boolean;
}

/**
 * GET through `safeFetch` (SSRF-checked, pinned, timed out), following up to
 * MAX_REDIRECTS redirects (each hop checked again) and reading at most
 * `maxBytes`. With `allowTruncation` a longer body is cut instead of refused
 * (enough for an HTML head). Null on any failure or non-2xx answer.
 */
async function fetchLimited(
  url: string,
  options: { maxBytes: number; accept: string; allowTruncation?: boolean },
): Promise<Fetched | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await safeFetch(current, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT, Accept: options.accept },
      });
    } catch (error) {
      logger.debug({ url: current, err: error }, "Branding fetch failed");
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return null;
      try {
        current = new URL(location, current).href;
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > options.maxBytes && !options.allowTruncation) {
      await response.body.cancel().catch(() => undefined);
      return null;
    }
    return readCapped(response.body, options.maxBytes, current, !!options.allowTruncation);
  }
  return null;
}

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  url: string,
  allowTruncation: boolean,
): Promise<Fetched | null> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        if (!allowTruncation) return null;
        chunks.push(Buffer.from(value.subarray(0, value.byteLength - (total - maxBytes))));
        return { body: Buffer.concat(chunks), url, truncated: true };
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    logger.debug({ url, err: error }, "Branding fetch read failed");
    return null;
  }
  return { body: Buffer.concat(chunks), url, truncated: false };
}

function websiteUrl(website: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The site's icon candidates, best first. The page failing still leaves /favicon.ico. */
async function findIconCandidates(site: URL): Promise<IconCandidate[]> {
  const page = await fetchLimited(site.href, {
    maxBytes: MAX_HTML_BYTES,
    accept: "text/html,application/xhtml+xml",
    allowTruncation: true,
  });
  if (!page) return [{ url: new URL("/favicon.ico", site).href, kind: "favicon", size: null }];

  const { icons, manifestUrl } = parseIconLinks(page.body.toString("utf8"), page.url);
  if (manifestUrl) {
    const manifest = await fetchLimited(manifestUrl, {
      maxBytes: MAX_MANIFEST_BYTES,
      accept: "application/manifest+json,application/json",
    });
    if (manifest) {
      try {
        icons.push(...parseManifestIcons(JSON.parse(manifest.body.toString("utf8")), manifest.url));
      } catch {
        logger.debug({ manifestUrl }, "Web manifest is not JSON");
      }
    }
  }
  return rankIconCandidates(icons);
}

async function downloadBestIcon(candidates: IconCandidate[]): Promise<DecodedIcon | null> {
  for (const candidate of candidates.slice(0, MAX_ICON_ATTEMPTS)) {
    const file = await fetchLimited(candidate.url, { maxBytes: MAX_ICON_BYTES, accept: "image/*" });
    if (!file) continue;
    const icon = await decodeIcon(file.body);
    if (icon) return icon;
  }
  return null;
}

export class BrandingImportService {
  private readonly running = new Set<string>();

  /**
   * Import the logo and colours from `website`. Resolves once done; never
   * throws. Concurrent imports for one organization collapse into the first.
   */
  async importFromWebsite(organizationId: string, website: string): Promise<void> {
    if (this.running.has(organizationId)) return;
    this.running.add(organizationId);
    const log = logger.child({ organizationId });
    try {
      await this.run(organizationId, website, log);
    } catch (error) {
      log.warn({ err: error }, "Website branding import failed");
    } finally {
      this.running.delete(organizationId);
    }
  }

  /** Start an import without waiting for it (website save, lazy settings read). */
  startImport(organizationId: string, website: string): void {
    void this.importFromWebsite(organizationId, website);
  }

  private async run(
    organizationId: string,
    website: string,
    log: Pick<typeof logger, "info" | "warn">,
  ): Promise<void> {
    await webchatSettingsRepository.getOrCreate(organizationId);
    await webchatSettingsRepository.patch(organizationId, { brandingImportedAt: new Date() });

    const site = websiteUrl(website);
    if (!site) return;

    const icon = await downloadBestIcon(await findIconCandidates(site));
    if (!icon) {
      log.info({ website: site.origin }, "No usable website icon found");
      return;
    }

    const palette = await paletteOfImage(icon.png);
    await webchatSettingsRepository.applyImportedColors(organizationId, palette);

    if (icon.size <= MAX_SKIPPED_ICON_SIZE) {
      log.info({ size: icon.size }, "Website icon too small for a logo; colours only");
      return;
    }
    const settings = await webchatSettingsRepository.getOrCreate(organizationId);
    if (settings.logoSource === "custom") return;

    const { upload } = await storageService.upload({
      buffer: icon.png,
      originalName: "webchat-logo.png",
      mimeType: "image/png",
      folder: LOGO_FOLDER,
      organizationId,
    });
    const { applied, previousUploadId } = await webchatSettingsRepository.applyImportedLogo(
      organizationId,
      upload.id,
    );
    const stale = applied ? previousUploadId : upload.id;
    if (stale) {
      await storageService
        .delete(stale)
        .catch((error) => log.warn({ err: error }, "Could not delete the old webchat logo"));
    }
    log.info({ website: site.origin, palette, logo: applied }, "Website branding imported");
  }
}

export const brandingImportService = new BrandingImportService();
