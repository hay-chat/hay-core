/* eslint-disable */
// One-off (D8-1 switch-over): set ACL private on media that used to be uploaded public-read.
// Run inside the hay-server container AFTER the private-media release is deployed, so it uses
// the container's own S3_* env:
//   docker cp scripts/make-media-private.cjs hay-server:/tmp/make-media-private.cjs
//   docker exec hay-server node /tmp/make-media-private.cjs            # dry run: counts only
//   docker exec hay-server node /tmp/make-media-private.cjs --apply    # change ACLs
// Public folders (organizations, avatars, document-images) are left untouched.
const { createRequire } = require("module");
const path = require("path");

function loadS3() {
  for (const base of [process.cwd(), path.join(process.cwd(), "server"), "/app", "/app/server"]) {
    try {
      return createRequire(path.join(base, "noop.js"))("@aws-sdk/client-s3");
    } catch {}
  }
  throw new Error("@aws-sdk/client-s3 not found; run from the server's working directory");
}

const { S3Client, ListObjectsV2Command, PutObjectAclCommand } = loadS3();
const PRIVATE_FOLDER = /^uploads\/[^/]+\/(conversation-media|documents|plugin-zips)\//;
const apply = process.argv.includes("--apply");

const bucket = process.env.S3_BUCKET;
let endpoint = process.env.S3_ENDPOINT;
if (!bucket || !endpoint) throw new Error("S3_BUCKET / S3_ENDPOINT not set: is this the right container?");
if (endpoint.includes(`${bucket}.`)) endpoint = endpoint.replace(`${bucket}.`, ""); // same as storage.service.ts

const s3 = new S3Client({
  endpoint,
  region: process.env.S3_REGION || "us-east-1",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  forcePathStyle: false,
});

(async () => {
  let token;
  let seen = 0;
  let matched = 0;
  let changed = 0;
  const failed = [];
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "uploads/", ContinuationToken: token }),
    );
    for (const { Key } of page.Contents || []) {
      seen++;
      if (!PRIVATE_FOLDER.test(Key)) continue;
      matched++;
      if (!apply) continue;
      try {
        await s3.send(new PutObjectAclCommand({ Bucket: bucket, Key, ACL: "private" }));
        changed++;
      } catch (e) {
        failed.push(`${Key}: ${e.name}`);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  console.log(`bucket=${bucket} objects under uploads/=${seen} to-make-private=${matched}`);
  if (apply) console.log(`made private=${changed} failed=${failed.length}`);
  else console.log("Dry run. Re-run with --apply to change ACLs.");
  failed.slice(0, 20).forEach((f) => console.log("  failed", f));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
