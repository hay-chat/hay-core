jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import { documentSourceRepository } from "@server/repositories/document-source.repository";
import type { Repository } from "typeorm";
import type { DocumentSource } from "@server/entities/document-source.entity";

const update = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  update.mockClear();
  jest
    .spyOn(
      documentSourceRepository as unknown as { getRepository(): Repository<DocumentSource> },
      "getRepository",
    )
    .mockReturnValue({ update } as unknown as Repository<DocumentSource>);
});

const savedCursor = () => update.mock.calls[0][1].lastSyncCursor;

describe("recordSyncResult cursor", () => {
  it("writes null on success, so the column is cleared rather than skipped", async () => {
    await documentSourceRepository.recordSyncResult("s", { status: "success", cursor: null });
    expect(savedCursor()).toBeNull();
  });

  it("stores the resume point on a partial run", async () => {
    await documentSourceRepository.recordSyncResult("s", { status: "partial", cursor: "40" });
    expect(savedCursor()).toBe("40");
  });

  it("keeps the existing resume point when a failed run has none", async () => {
    await documentSourceRepository.recordSyncResult("s", { status: "error", cursor: null });
    expect(savedCursor()).toBeUndefined();
  });
});
