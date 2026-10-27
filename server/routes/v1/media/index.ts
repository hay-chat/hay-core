import { Router, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { requireAuth } from "@server/lib/auth/middleware";
import { createLogger } from "@server/lib/logger";
import { Upload } from "@server/entities/upload.entity";
import { storageService } from "@server/services/storage.service";
import { isUuid, verifyMediaSignature } from "@server/services/media-url.service";
import { ACTIONS, RESOURCES } from "@server/types/scopes";

/**
 * GET /v1/media/:id — the only way to read a private upload.
 *
 * Access is granted by either:
 *   - a valid `?expires=&sig=` signature minted by core (media-url.service), or
 *   - a staff session: `Authorization: Bearer` + `x-organization-id` of the
 *     upload's organization, with read access to the upload's resource.
 *
 * Everything else gets 401 (no credentials) or 404 (credentials that don't
 * cover this upload), so upload ids from other organizations are not
 * distinguishable from missing ones.
 */

const logger = createLogger("media-route");

const router = Router();

/** Types a browser may render in place; everything else is forced to download. */
function isInlineType(mimeType: string): boolean {
  if (mimeType === "image/svg+xml") return false;
  return /^(image|audio|video)\//.test(mimeType);
}

/** RFC 6266 header with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(mimeType: string, originalName: string): string {
  const type = isInlineType(mimeType) ? "inline" : "attachment";
  const asciiName = originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}

/** Resource/action a staff member needs to read files in this folder. */
function requiredScope(folder: string): [string, string] {
  if (folder === "conversation-media") return [RESOURCES.CONVERSATIONS, ACTIONS.READ];
  if (folder.startsWith("documents")) return [RESOURCES.DOCUMENTS, ACTIONS.READ];
  return [RESOURCES.ALL, RESOURCES.ALL];
}

type AccessResult = "granted" | "unauthenticated" | "denied";

async function checkAccess(req: Request, upload: Upload): Promise<AccessResult> {
  const { expires, sig } = req.query;
  if (expires !== undefined || sig !== undefined) {
    return verifyMediaSignature(upload.id, expires, sig) ? "granted" : "denied";
  }

  if (!req.headers.authorization) return "unauthenticated";

  let user;
  try {
    user = await requireAuth(req);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return "denied";
    return "unauthenticated";
  }

  const headerOrganizationId = req.headers["x-organization-id"];
  if (headerOrganizationId !== upload.organizationId) return "denied";
  if (user.organizationId !== upload.organizationId) return "denied";

  const [resource, action] = requiredScope(upload.folder);
  return user.hasScope(resource, action) ? "granted" : "denied";
}

/** Parse a single `bytes=start-end` range. Returns null when absent or unsatisfiable. */
function parseRange(header: string | undefined, size: number): [number, number] | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;

  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const upload = await Upload.findOne({ where: { id } });
    if (!upload) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const access = await checkAccess(req, upload);
    if (access === "unauthenticated") {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (access === "denied") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { buffer } = await storageService.download(upload.id);

    res.set({
      "Content-Type": upload.mimeType,
      "Content-Disposition": contentDisposition(upload.mimeType, upload.originalName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "private, max-age=300",
      Vary: "Authorization, x-organization-id",
      "Accept-Ranges": "bytes",
    });

    const range = parseRange(req.headers.range, buffer.length);
    if (req.headers.range && !range) {
      res.status(416).set("Content-Range", `bytes */${buffer.length}`).end();
      return;
    }
    if (range) {
      const [start, end] = range;
      res
        .status(206)
        .set("Content-Range", `bytes ${start}-${end}/${buffer.length}`)
        .send(buffer.subarray(start, end + 1));
      return;
    }

    res.status(200).send(buffer);
  } catch (error) {
    logger.error({ err: error, uploadId: id }, "Failed to serve media");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to load media" });
    }
  }
});

export default router;
