import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "@jest/globals";
import { buildSslOptions } from "@server/database/data-source";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("buildSslOptions", () => {
  it("disables TLS when DB_SSL is off", () => {
    expect(buildSslOptions(false, PEM)).toBe(false);
  });

  it("verifies the server certificate when a CA is configured", () => {
    expect(buildSslOptions(true, PEM)).toEqual({ rejectUnauthorized: true, ca: PEM });

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "db-ca-")), "ca.pem");
    fs.writeFileSync(file, PEM);
    expect(buildSslOptions(true, file)).toEqual({ rejectUnauthorized: true, ca: PEM });
  });

  it("encrypts without verification when no CA is configured", () => {
    expect(buildSslOptions(true, "")).toEqual({ rejectUnauthorized: false });
  });
});
