import { describe, expect, it, vi } from "vitest";
import { setDocumentsArchived } from "../utils/document-archive";

// The Archive action used to flip the row locally and never call the server.
describe("setDocumentsArchived", () => {
  it("sends the status to the server for every document", async () => {
    const update = vi.fn().mockResolvedValue({});
    const result = await setDocumentsArchived(["a", "b"], true, update);
    expect(update).toHaveBeenCalledWith({ id: "a", status: "archived" });
    expect(update).toHaveBeenCalledWith({ id: "b", status: "archived" });
    expect(result).toEqual({ succeeded: ["a", "b"], failed: [] });
  });

  it("restores as published and reports failures instead of hiding them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const update = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});
    const result = await setDocumentsArchived(["a", "b"], false, update);
    expect(update).toHaveBeenCalledWith({ id: "b", status: "published" });
    expect(result).toEqual({ succeeded: ["b"], failed: ["a"] });
  });
});
