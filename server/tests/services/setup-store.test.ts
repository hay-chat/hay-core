jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import { normalize } from "../../services/setup/store";
import type { SetupSettings } from "@server/types/setup.types";

describe("setup store normalize", () => {
  const returns = { id: "d1", title: "Returns" };

  it("reads a question's stored single link as a list of one", () => {
    const stored = {
      toolPluginIds: [],
      channels: [],
      questions: [{ id: "q1", text: "Refunds?", source: "custom", linkedDocument: returns }],
      recentlyRemoved: [
        { index: 0, question: { id: "q2", text: "x", source: "custom", linkedDocument: returns } },
      ],
    } as unknown as SetupSettings;
    const setup = normalize(stored);
    expect(setup.questions[0]).toEqual({
      id: "q1",
      text: "Refunds?",
      source: "custom",
      linkedDocuments: [returns],
    });
    expect(setup.recentlyRemoved?.[0].question.linkedDocuments).toEqual([returns]);
  });

  it("keeps a list already stored, and fills an empty setup", () => {
    const list = [returns, { id: "d2", title: "Shipping" }];
    const stored = {
      toolPluginIds: [],
      channels: [],
      questions: [{ id: "q1", text: "x", source: "custom", linkedDocuments: list }],
    } as unknown as SetupSettings;
    expect(normalize(stored).questions[0].linkedDocuments).toEqual(list);
    expect(normalize(null)).toEqual({ toolPluginIds: [], channels: [], questions: [] });
  });
});
