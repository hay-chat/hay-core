import { describe, expect, it } from "vitest";
import { describedCapabilities } from "./pluginSetup";

describe("describedCapabilities", () => {
  it("reads SDK array capabilities and drops plumbing ones", () => {
    expect(describedCapabilities(["mcp", "auth", "cron", "disputes"])).toEqual(["mcp", "disputes"]);
    expect(describedCapabilities(["messages", "customers"])).toEqual(["messages", "customers"]);
  });

  it("maps legacy object capabilities", () => {
    expect(
      describedCapabilities({
        chat_connector: { features: {} },
        document_importer: {},
        mcp: false,
      }),
    ).toEqual(["messages", "documents"]);
  });

  it("returns nothing for missing capabilities", () => {
    expect(describedCapabilities(undefined)).toEqual([]);
    expect(describedCapabilities(["config"])).toEqual([]);
  });
});
