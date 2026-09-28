import { parseConnectedAccount } from "../../lib/connected-account";

describe("parseConnectedAccount", () => {
  it("keeps a label and an https avatar", () => {
    expect(
      parseConnectedAccount({ label: "@haydotchat", avatarUrl: "https://cdn.example/p.jpg" }),
    ).toEqual({ label: "@haydotchat", avatarUrl: "https://cdn.example/p.jpg" });
  });

  it("drops a non-http avatar but keeps the label", () => {
    expect(parseConnectedAccount({ label: "@x", avatarUrl: "javascript:alert(1)" })).toEqual({
      label: "@x",
      avatarUrl: undefined,
    });
  });

  it.each([undefined, null, "str", {}, { label: "" }, { label: "  " }, { label: 42 }])(
    "rejects %p",
    (value) => {
      expect(parseConnectedAccount(value)).toBeUndefined();
    },
  );

  it("caps very long labels", () => {
    expect(parseConnectedAccount({ label: "a".repeat(500) })?.label).toHaveLength(200);
  });
});
