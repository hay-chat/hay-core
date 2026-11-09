import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../markdown";

describe("parseMarkdown image allowlist", () => {
  const md = "![pic](https://evil.test/a.png?x=1&y=2)";

  it("shows an unapproved image as a link and never requests it", () => {
    const html = parseMarkdown(md, []);
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://evil.test/a.png?x=1&y=2"');
    expect(html).toContain("pic");
  });

  it("renders an image the server approved", () => {
    expect(parseMarkdown(md, ["https://evil.test/a.png?x=1&y=2"])).toContain("<img");
  });
});
