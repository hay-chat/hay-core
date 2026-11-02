#!/usr/bin/env node
/**
 * One-off: document images used to be stored publicly and embedded by their
 * storage URL. This rewrites those URLs in documents (content and editor
 * JSON) to the stable /v1/media/:id URL, which readers get signed, and
 * revokes public read on the stored files (S3 ACL). Safe to run again.
 *
 *   npm run documents:privatize-images
 */
import { AppDataSource } from "../database/data-source";
import { Document } from "../entities/document.entity";
import { Upload } from "../entities/upload.entity";
import { DOCUMENT_IMAGES_FOLDER, mediaUrl } from "../services/media-url.service";
import { storageService } from "../services/storage.service";

/** `.../{organizationId}/document-images/{filename}` as stored by the former public URLs. */
const LEGACY_URL =
  /(?:https?:)?\/\/[^\s"'<>()]*?\/([0-9a-f-]{36})\/document-images\/([0-9a-f-]{36}\.[a-z0-9]+)/gi;

/**
 * Replace former public document-image URLs of this organization with the
 * stable media URL of the matching upload (looked up by stored file name).
 */
export function rewriteLegacyDocumentImageUrls(
  text: string,
  organizationId: string,
  uploadIdByFilename: Map<string, string>,
): string {
  return text.replace(LEGACY_URL, (match, orgId: string, filename: string) => {
    const uploadId = uploadIdByFilename.get(filename);
    return orgId === organizationId && uploadId ? mediaUrl(uploadId) : match;
  });
}

async function main() {
  await AppDataSource.initialize();

  const uploads = await Upload.find({ where: { folder: DOCUMENT_IMAGES_FOLDER } });
  const idsByOrg = new Map<string, Map<string, string>>();
  for (const upload of uploads) {
    const ids = idsByOrg.get(upload.organizationId) ?? new Map<string, string>();
    ids.set(upload.filename, upload.id);
    idsByOrg.set(upload.organizationId, ids);
  }

  const documents = await AppDataSource.getRepository(Document)
    .createQueryBuilder("d")
    .where("d.content LIKE :needle OR d.contentJson::text LIKE :needle", {
      needle: `%/${DOCUMENT_IMAGES_FOLDER}/%`,
    })
    .getMany();

  let rewritten = 0;
  for (const document of documents) {
    const ids = idsByOrg.get(document.organizationId) ?? new Map<string, string>();
    const content = document.content
      ? rewriteLegacyDocumentImageUrls(document.content, document.organizationId, ids)
      : document.content;
    const contentJson = document.contentJson
      ? JSON.parse(
          rewriteLegacyDocumentImageUrls(
            JSON.stringify(document.contentJson),
            document.organizationId,
            ids,
          ),
        )
      : document.contentJson;
    if (
      content !== document.content ||
      JSON.stringify(contentJson) !== JSON.stringify(document.contentJson)
    ) {
      await AppDataSource.getRepository(Document).update(document.id, { content, contentJson });
      rewritten++;
    }
  }

  for (const upload of uploads) {
    await storageService.makePrivate(upload);
  }

  console.log(
    `Rewrote image URLs in ${rewritten} of ${documents.length} documents; ` +
      `made ${uploads.length} document images private.`,
  );
  await AppDataSource.destroy();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Document image migration failed:", error);
    process.exit(1);
  });
}
