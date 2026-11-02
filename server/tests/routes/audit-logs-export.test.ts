import { describe, it, expect } from "@jest/globals";
import { convertToCSV } from "../../routes/v1/audit-logs";
import type { AuditLog } from "../../entities/audit-log.entity";

describe("audit log CSV export", () => {
  it("neutralises spreadsheet formulas in every cell", () => {
    const csv = convertToCSV([
      {
        id: "1",
        createdAt: new Date("2026-10-29T00:00:00Z"),
        userId: undefined,
        action: "profile.update",
        resource: '=HYPERLINK("x")',
        status: "success",
        changes: { name: "x" },
        userAgent: "+cmd",
        errorMessage: "@SUM(A1)",
        ipAddress: "-1",
      } as unknown as AuditLog,
    ]);

    const [, row] = csv.split("\n");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain("'+cmd");
    expect(row).toContain("'@SUM(A1)");
    expect(row).toContain("'-1");
    expect(row).toContain("2026-10-29T00:00:00.000Z");
    expect(row).not.toMatch(/(^|,)[=+\-@]/);
  });
});
