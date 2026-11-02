import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/config/env", () => ({
  config: { jwt: { secret: "test" }, storage: { s3: {}, local: {}, limits: {}, clamav: {} } },
  getApiUrl: () => "https://api.example.test",
}));
jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/entities/document.entity", () => ({ Document: class {} }));
jest.mock("@server/entities/upload.entity", () => ({ Upload: {} }));
jest.mock("@server/services/storage.service", () => ({ storageService: {} }));

import { rewriteLegacyDocumentImageUrls } from "../../scripts/privatize-document-images";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const FILE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc.png";
const UPLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("rewriteLegacyDocumentImageUrls", () => {
  const ids = new Map([[FILE, UPLOAD_ID]]);

  it("rewrites S3 and local public URLs of this organization to the media URL", () => {
    const html =
      `<img src="https://ams3.example.com/bucket/uploads/${ORG_ID}/document-images/${FILE}">` +
      `<img src="http://localhost:3001/uploads/${ORG_ID}/document-images/${FILE}">`;

    expect(rewriteLegacyDocumentImageUrls(html, ORG_ID, ids)).toBe(
      `<img src="https://api.example.test/v1/media/${UPLOAD_ID}">`.repeat(2),
    );
  });

  it("leaves URLs of other organizations and unknown files alone", () => {
    const foreign = `<img src="https://cdn.example/${OTHER_ORG}/document-images/${FILE}">`;
    const unknown = `<img src="https://cdn.example/${ORG_ID}/document-images/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png">`;

    expect(rewriteLegacyDocumentImageUrls(foreign + unknown, ORG_ID, ids)).toBe(foreign + unknown);
  });
});
