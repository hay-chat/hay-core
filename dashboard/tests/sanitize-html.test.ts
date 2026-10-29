// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../utils/sanitize";

// Editor documents are shown with v-html; their HTML goes through sanitizeHtml.
describe("sanitizeHtml", () => {
  it("removes scripts, event handlers and script URLs", () => {
    const html = sanitizeHtml(
      '<p>Hi</p><img src="x" onerror="alert(1)"><script>alert(2)</script>' +
        '<a href="javascript:alert(3)">a</a><a href="java&#x09;script:alert(4)">b</a>' +
        '<a href=" &#x01;javascript:alert(5)">c</a>',
    );

    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toMatch(/onerror|<script|javascript/i);
  });

  it("keeps ordinary links and images", () => {
    const html = sanitizeHtml('<a href="https://hay.chat">x</a><img src="https://x/y.png">');
    expect(html).toContain('href="https://hay.chat"');
    expect(html).toContain('src="https://x/y.png"');
  });
});
